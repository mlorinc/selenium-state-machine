import { error } from 'selenium-webdriver';
import { DependencyMap, StaleDependencyReferenceError } from './Dependency';
import { CriticalError, TimeoutError } from './Error';
import { State } from './State';
import { ProvideComplete, ProvideFunction, ProvidePublic } from './Provide';
import { logger } from './Logger';
import winston = require('winston');
import { WebElementDependency } from './WebElementDependency';
import { Timer } from './Timer';

/*
 * Context for fsm
 */
export interface BaseContext {
    /**
     * Remaining time for fsm
     */
    timeout: number
}

interface InternalContext<T extends BaseContext> {
    userContext: T,
    timeout: number,
    timers: { [name: string]: Timer }
}

/**
 * State machine implementation which is capable of recovering stale dependencies.
 * The first added state is considered as starting state. The last added is finish state.
 * To add states call a {@link state} method.
 */
export class StateMachine<TContext extends BaseContext, TDependencyMap extends DependencyMap> {
    /**
     * State machine context
     */
    private _context: InternalContext<TContext>;
    /**
     * Current state index
     */
    private _i: number;
    /**
     * Number of iterations on state
     */
    private _stateCounter: number;
    /**
     * Map state name => state index
     */
    private _nameMap: Map<string, number>;
    /**
     * Promise which is resolved when state machines is done
     */
    private _promise: Promise<void> | undefined;
    /**
     * Set of reached states
     */
    private _reachedStates: Set<string>;
    /**
     * Running flag
     */
    private _running: boolean;
    /**
     * List of all states
     */
    private _states: State<TContext, TDependencyMap>[];
    /**
     * Spent time on current state
     */
    private _timeOnState: number;
    /**
     * List of transition callbacks
     */
    private _transitionCallbacks: ((machine: StateMachine<TContext, TDependencyMap>, logger: winston.Logger) => void | PromiseLike<void>)[];

    constructor(context: TContext, private dependencies: TDependencyMap) {
        this._context = { userContext: context, timeout: context.timeout, timers: {} };
        this._i = 0;
        this._stateCounter = 0;
        this._nameMap = new Map();
        this._promise = undefined;
        this._reachedStates = new Set();
        this._running = false;
        this._states = [];
        this._timeOnState = 0;
        this._transitionCallbacks = [];
    }

    /**
     * Get context values. Please take in mind timeout will be the same during run.
     */
    public get context() : TContext {
        return this._context.userContext;
    }

    /**
     * Update context values. Make sure you are using immutable types. 
     * @param data which will take part in new context
     */
    public updateContext(data: Partial<TContext>): void {
        this._context.userContext = {
            ...this._context.userContext,
            ...data
        };
    }

    /**
     * Get name of current state
     */
    public get currentState(): string {
        return this._i < this._states.length ? this._states[this._i].name : 'end';
    }

    /**
     * Get time spent on current state
     */
    public get timeOnCurrentState(): number {
        return this._timeOnState;
    }

    /**
     * Get remaining timeout
     */
    public get timeout(): number {
        return this._context.timeout;
    }

    /**
     * Set timeout. Please note this cannot be done when state machine is running.
     */
    public set timeout(v: number) {
        if (this._running) {
            throw new CriticalError('cannot change timeout when pipeline is running');
        }

        this._context.timeout = v;
    }

    /**
     * Create new timer. Useful when it is not desirable perform WebElement click every state transition.
     * @param name new name of the timer
     * @param timeout time after timer will be in state 'elapsed'
     */
    public createTimer(name: string | ProvideFunction<never, never>, timeout: number): void {
        const stringName = typeof name === 'string' ? name : name.name;
        this._context.timers[stringName] = new Timer(this._context.timeout, timeout);
    }

    /**
     * Clear set timer with name.
     * @param name name of the timer
     */
    public clearTimer(name: string | ProvideFunction<never, never>): void {
        const stringName = typeof name === 'string' ? name : name.name;
        delete this._context.timers[stringName];
    }

    /**
     * Check if timer is set.
     * @param name name of the timer in question
     * @returns boolean signalling availability
     */
    public hasTimer(name: string | ProvideFunction<never, never>): boolean {
        const stringName = typeof name === 'string' ? name : name.name;
        return this._context.timers[stringName] !== undefined;
    }

    /**
     * Check if timer has elapsed.
     * @param name name of the timer in question
     * @returns boolean signaling its state
     */
    public hasElapsedTimer(name: string | ProvideFunction<never, never>): boolean {
        const stringName = typeof name === 'string' ? name : name.name;
        const timer = this._context.timers[stringName];

        if (timer !== undefined) {
            return timer.elapsed(this._context.timeout);
        }

        throw new CriticalError(`unknown timer ${stringName}`);
    }

    /**
     * Add new state
     * @param state state to be added
     * @returns self
     */
    private addState(state: State<TContext, TDependencyMap>): this {
        this._states.push(state);
        this._nameMap.set(state.name, this._states.length - 1);
        return this;
    }

    /**
     * Notify all transition listeners
     * @returns 
     */
    private notify(): Promise<void[]> {
        return Promise.all(this._transitionCallbacks.map((x) => x(this, logger)));
    }

    /**
     * Register new on transition callback
     * @param callback function to be called
     */
    public onTransition(callback: typeof this._transitionCallbacks[0]) {
        this._transitionCallbacks.push(callback);
    }

    /**
     * Wait until state has been reached. It may return result from past so check {@link currentState} as well.
     * @param name name of state or function which is called
     * @param timeout timeout in ms
     */
    public async waitUntilReached(name: string | ProvideFunction<TContext, TDependencyMap>, timeout?: number): Promise<void> {
        const stringName = typeof name === 'string' ? name : name.name;
        timeout = timeout !== undefined ? timeout : Number.POSITIVE_INFINITY;

        const end = Date.now() + timeout;
        while (!this._reachedStates.has(stringName) && Date.now() < end) {
            await new Promise((resolve) => setImmediate(resolve));
        }
    }

    /**
     * Add new state to the state machine and infer state name.
     * @param f State functions which is called each tick. The function must return ProvideComplete object by using given DSL.
     * In case no dependencies are provides, use provide.nothing() otherwise use provide.dependency(dependencyObject, value).
     * After that select one of next, previous or transition. If nothing was provides tryAgain is available. Depending on selected option
     * the state machine will perform transition to next/previous/selected state or repeat itself.
     * @param timeout 
     * @returns self
     */
    public state(f: ((provide: ProvidePublic<TContext, TDependencyMap>, dependencies: TDependencyMap) => Promise<ProvideComplete<TContext, TDependencyMap>> | ProvideComplete<TContext, TDependencyMap>
    ), timeout?: number): this {
        const state = new State<TContext, TDependencyMap>({ f, timeout }, this._states.length, {
            context: this.context,
            timeout: this.timeout,
            timers: this._context.timers
        });
        return this.addState(state);
    }

    /**
     * Add new state to the state machine.
     * @param name Name of the state
     * @param f State functions which is called each tick. The function must return ProvideComplete object by using given DSL.
     * In case no dependencies are provides, use provide.nothing() otherwise use provide.dependency(dependencyObject, value).
     * After that select one of next, previous or transition. If nothing was provides tryAgain is available. Depending on selected option
     * the state machine will perform transition to next/previous/selected state or repeat itself.
     * @param timeout timeout on the state
     * @returns self
     */
    public namedState(name: string, f: ((provide: ProvidePublic<TContext, TDependencyMap>, dependencies: TDependencyMap) => Promise<ProvideComplete<TContext, TDependencyMap>> | ProvideComplete<TContext, TDependencyMap>
    ), timeout?: number): this {
        const state = new State<TContext, TDependencyMap>({ f, name, timeout }, this._states.length, {
            context: this.context,
            timeout: this.timeout,
            timers: this._context.timers
        });
        return this.addState(state);
    }

    /**
     * Perform transition.
     * @param i new state index
     * @returns void
     */
    private changeIndex(i: number): void {
        if (this._i === i) {
            return;
        }

        if (i < 0) {
            throw new CriticalError('cannot go to previous checkpoint');
        }

        const newStateName = i < this._states.length ? this._states[i].name : 'end';
        logger.info(`executed function in state ${this.currentState} x${this._stateCounter} times and spent ${this._timeOnState}ms`);
        logger.info(`transition from ${this._states[this._i].name} to ${newStateName}`);
        this._i = i;
        this._timeOnState = 0;
        this._stateCounter = 0;
        this._reachedStates.add(newStateName);
        this.notify();
    }

    /**
     * Stop the state machine.
     */
    public stop(): void {
        this._running = false;
    }

    /**
     * Start the state machine.
     * @returns promise which resolved when the state machine is on end state
     */
    public async start(): Promise<void> {
        this._promise = this.helperStart();
        const newStateName = this._i < this._states.length ? this._states[this._i].name : 'end';
        this._reachedStates.add(newStateName);
        return this._promise;
    }

    /**
     * Wait until the end state is reached.
     * @returns 
     */
    public async wait(): Promise<void> {
        if (this._promise === undefined) {
            throw new CriticalError('state machine is not running');
        }

        return this._promise;
    }

    private async helperStart(): Promise<void> {
        if (this._running) {
            throw new CriticalError('state machine is already running');
        }

        this._running = true;

        process.on('SIGINT', () => this._running = false);
        process.on('uncaughtException', () => this._running = false);

        while (this._running && this._context.timeout > 0) {
            if (this._i >= this._states.length) {
                logger.info('state machine has reached the end state');
                return;
            }

            const state = this._states[this._i];

            if (state.timeout <= this._timeOnState) {
                throw new TimeoutError(`timed out on checkpoint number ${this._i + 1} // (indexing from 1)`);
            }

            const started = Date.now();
            try {
                const provide = await state.execute(this.dependencies);
                const delta = Date.now() - started;
                this._timeOnState += delta;
                this._stateCounter += 1;
                this._context.timeout -= delta;

                for (const key of Object.keys(provide.updateMap)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.dependencies as any)[key] = provide.updateMap[key];
                }

                for (const timer of provide.staleTimers) {
                    this.clearTimer(timer);
                }

                for (const timer of provide.newTimers) {
                    this.createTimer(timer.name, timer.timeout);
                }

                this.updateContext(provide.context);

                if (provide.doesRepeat()) {
                    continue;
                }
                else if (provide.doesGoNext()) {
                    this.changeIndex(this._i + 1);
                }
                else if (provide.doesGoPrevious()) {
                    this.changeIndex(this._i - 1);
                }
                else if (provide.doesTransition()) {
                    const index = this._nameMap.get(provide.transitionState);

                    if (index === undefined) {
                        throw new CriticalError(`state "${provide.transitionState}" does not exist`);
                    }

                    this.changeIndex(index);
                }
                else {
                    throw new CriticalError('unknown state transition');
                }
            }
            catch (e) {
                if (e instanceof StaleDependencyReferenceError) {
                    if (e.dependency instanceof WebElementDependency) {
                        logger.info(`stale WebElement with name ${e.dependency.name} located in ${this.currentState}`,
                            {
                                name: e.dependency?.debugElement?.constructor.name ?? 'unknown',
                                element: e.dependency.debugElement
                            });
                    }
                    else {
                        logger.info(`stale dependency with name ${e.dependency.name} located in ${this.currentState}`);
                    }

                    if (e.dependency.provider !== undefined) {
                        this.changeIndex(e.dependency.provider.index);
                    }
                    else {
                        logger.error(`cannot recover WebElement from stale state in state ${this.currentState}`);
                        throw e;
                    }
                }
                else if (e instanceof error.NoSuchElementError || e instanceof error.ElementClickInterceptedError) {
                    // continue
                }
                else if (e instanceof error.StaleElementReferenceError) {
                    // warn user it might be error
                    logger.warn(`unprotected WebElement is located in ${this.currentState}`);
                }
                else {
                    logger.error(`non fixable unknown error in ${this.currentState}`,
                        {
                            error
                        });
                    throw e;
                }
                const delta = Date.now() - started;
                this._context.timeout -= delta;
            }
        }

        logger.info(`executed function in state ${this.currentState} x${this._stateCounter} times and spent ${this._timeOnState}ms`);

        if (!this._running && this._context.timeout > 0) {
            logger.info(`stopped the state machine on state ${this.currentState}`);
            return;
        }

        if (this._i !== this._states.length) {
            logger.error(`timed out the state machine on state ${this.currentState}`);
            throw new TimeoutError(`timed out the state machine on state ${this.currentState}`);
        }
    }
}

/**
 * Declare the state machine dependencies. It is capable of inferring names.
 * @param dependencies 
 * @returns the same dependencies but with name set as their key
 */
export function declareDependencies<T extends DependencyMap>(dependencies: T): T {
    for (const key of Object.keys(dependencies)) {
        dependencies[key].name = key;
    }

    return dependencies;
}
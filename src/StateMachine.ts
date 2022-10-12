import { error } from 'selenium-webdriver';
import { DependencyMap, StaleDependencyReferenceError } from './Dependency';
import { CriticalError, TimeoutError } from './Error';
import { State } from './State';
import { ProvideComplete, ProvideFunction, ProvidePublic } from './Provide';
import { logger } from './Logger';
import winston = require('winston');

/*
 * Context for fsm
 */
export interface BaseContext {
    /**
     * Remaining time for fsm
     */
    timeout: number;
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
    private context: TContext;
    /**
     * Current state index
     */
    private i: number;
    /**
     * Number of iterations on state
     */
    private stateCounter: number;
    /**
     * Map state name => state index
     */
    private nameMap: Map<string, number>;
    /**
     * Promise which is resolved when state machines is done
     */
    private promise: Promise<void> | undefined;
    /**
     * Set of reached states
     */
    private reachedStates: Set<string>;
    /**
     * Running flag
     */
    private running: boolean;
    /**
     * List of all states
     */
    private states: State<TDependencyMap>[];
    /**
     * Spent time on current state
     */
    private timeOnState: number;
    /**
     * List of transition callbacks
     */
    private transitionCallbacks: ((machine: StateMachine<TContext, TDependencyMap>, logger: winston.Logger) => void | PromiseLike<void>)[];

    constructor(context: TContext, private dependencies: TDependencyMap) {
        this.context = context;
        this.i = 0;
        this.stateCounter = 0;
        this.nameMap = new Map();
        this.promise = undefined;
        this.reachedStates = new Set();
        this.running = false;
        this.states = [];
        this.timeOnState = 0;
        this.transitionCallbacks = [];
    }
    
    /**
     * Get name of current state
     */
    public get currentState() : string {
        return this.i < this.states.length ? this.states[this.i].name : 'end';
    }

    /**
     * Get time spent on current state
     */
    public get timeOnCurrentState() : number {
        return this.timeOnState;
    }

    /**
     * Get remaining timeout
     */
    public get timeout() : number {
        return this.context.timeout;
    }
        
    /**
     * Set timeout. Please note this cannot be done when state machine is running.
     */
    public set timeout(v : number) {
        if (this.running) {
            throw new CriticalError('cannot change timeout when pipeline is running');
        }

        this.context.timeout = v;
    }

    /**
     * Add new state
     * @param state state to be added
     * @returns self
     */
    private addState(state: State<TDependencyMap>): this {
        this.states.push(state);
        this.nameMap.set(state.name, this.states.length - 1);
        return this;
    }

    /**
     * Notify all transition listeners
     * @returns 
     */
    private notify(): Promise<void[]> {
        return Promise.all(this.transitionCallbacks.map((x) => x(this, logger)));
    }

    /**
     * Register new on transition callback
     * @param callback function to be called
     */
    public onTransition(callback: typeof this.transitionCallbacks[0]) {
        this.transitionCallbacks.push(callback);
    }

    /**
     * Wait until state has been reached. It may return result from past so check {@link currentState} as well.
     * @param name name of state or function which is called
     * @param timeout timeout in ms
     */
    public async waitUntilReached(name: string | ProvideFunction<TDependencyMap>, timeout?: number): Promise<void> {
        const stringName = typeof name === 'string' ? name : name.name;
        timeout = timeout !== undefined ? timeout : Number.POSITIVE_INFINITY;

        const end = Date.now() + timeout;
        while (!this.reachedStates.has(stringName) && Date.now() < end) {
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
    public state(f: ((provide: ProvidePublic, dependencies: TDependencyMap) => Promise<ProvideComplete> | ProvideComplete
    ), timeout?: number): this {
        const state = new State<TDependencyMap>({ f, timeout }, this.states.length);
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
    public namedState(name: string, f: ((provide: ProvidePublic, dependencies: TDependencyMap) => Promise<ProvideComplete> | ProvideComplete
    ), timeout?: number): this {
        const state = new State<TDependencyMap>({ f, name, timeout }, this.states.length);
        return this.addState(state);
    }

    /**
     * Perform transition.
     * @param i new state index
     * @returns void
     */
    private changeIndex(i: number): void {
        if (this.i === i) {
            return;
        }

        if (i < 0) {
            throw new CriticalError('cannot go to previous checkpoint');
        }

        const newStateName = i < this.states.length ? this.states[i].name : 'end';
        logger.info(`executed function in state ${this.currentState} x${this.stateCounter} times and spent ${this.timeOnState}ms`);
        logger.info(`transition from ${this.states[this.i].name} to ${newStateName}`);
        this.i = i;
        this.timeOnState = 0;
        this.stateCounter = 0;
        this.reachedStates.add(newStateName);
        this.notify();
    }

    /**
     * Stop the state machine.
     */
    public stop(): void {
        this.running = false;
    }

    /**
     * Start the state machine.
     * @returns promise which resolved when the state machine is on end state
     */
    public async start(): Promise<void> {
        this.promise = this.helperStart();
        const newStateName = this.i < this.states.length ? this.states[this.i].name : 'end';
        this.reachedStates.add(newStateName);
        return this.promise;
    }

    /**
     * Wait until the end state is reached.
     * @returns 
     */
    public async wait(): Promise<void> {
        if (this.promise === undefined) {
            throw new CriticalError('state machine is not running');
        }

        return this.promise;
    }

    private async helperStart(): Promise<void> {
        if (this.running) {
            throw new CriticalError('state machine is already running');
        }

        this.running = true;

        process.on('SIGINT', () => this.running = false);
        process.on('uncaughtException', () => this.running = false);

        while (this.running && this.context.timeout > 0) {
            if (this.i >= this.states.length) {
                logger.info('state machine has reached the end state');
                return;
            }

            const state = this.states[this.i];

            if (state.timeout <= this.timeOnState) {
                throw new TimeoutError(`timed out on checkpoint number ${this.i + 1} // (indexing from 1)`);
            }

            const started = Date.now();
            try {
                const provide = await state.execute(this.dependencies);
                const delta = Date.now() - started;
                this.timeOnState += delta;
                this.stateCounter += 1;

                for (const key of Object.keys(provide.updateMap)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (this.dependencies as any)[key] = provide.updateMap[key];
                }

                if (provide.doesRepeat()) {
                    continue;
                } 
                else if (provide.doesGoNext()) {
                    this.changeIndex(this.i + 1);
                } 
                else if (provide.doesGoPrevious()) {
                    this.changeIndex(this.i - 1);
                }
                else if (provide.doesTransition()) {
                    const index = this.nameMap.get(provide.transitionState);

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
                    logger.info(`stale WebElement located in ${this.currentState}`,
                        {
                            element: e.dependency.value
                        });
                    if (e.dependency.provider !== undefined) {
                        this.changeIndex(e.dependency.provider.index);
                    }
                    else {
                        logger.error(`cannot recover WebElement from stale state in state ${this.currentState}`);
                        throw e;
                    }
                }
                else if (e instanceof error.NoSuchElementError || e instanceof error.ElementClickInterceptedError) {
                    continue;
                }
                else if (e instanceof error.StaleElementReferenceError) {
                    // warn user it might be error
                    logger.warn(`unprotected WebElement is located in ${this.currentState}`);
                    continue;
                }
                else {
                    logger.error(`non fixable unknown error in ${this.currentState}`,
                        {
                            error
                        });
                    throw e;
                }
            }
            finally {
                const delta = Date.now() - started;
                this.context.timeout -= delta;
            }
        }

        logger.info(`executed function in state ${this.currentState} x${this.stateCounter} times and spent ${this.timeOnState}ms`);

        if (!this.running && this.context.timeout > 0) {
            logger.info(`stopped the state machine on state ${this.currentState}`);
            return;
        }

        if (this.i !== this.states.length) {
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
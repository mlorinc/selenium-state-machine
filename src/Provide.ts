import { State, StateProvideData } from './State';
import { DependencyMap, DependencyID, ValueDependency, Dependency } from './Dependency';
import { CriticalError } from './Error';
import { BaseContext } from './StateMachine';

export type ProvideFunction<TContext extends BaseContext, TDependencyMap extends DependencyMap> = (provide: ProvidePublic<TContext, TDependencyMap>, dependencies: TDependencyMap) => ProvideComplete<TContext, TDependencyMap> | Promise<ProvideComplete<TContext, TDependencyMap>>;

/**
 * Provide interface to provide required dependencies or nothing.
 */
export interface ProvidePublic<TContext extends BaseContext, TDependencyMap extends DependencyMap> {
    /**
     * Provide new dependency. Can be chained.
     * @param dependency dependency to be updated
     * @param newValue value which will be stored in the dependency
     */
    dependency<T>(dependency: Dependency<T>, newValue: T): DependencyProvider<TContext, TDependencyMap>;
    /**
     * Nothing will be provided by this method.
     */
    nothing(): ProvideNothing<TContext, TDependencyMap>;

    /**
     * Get context
     */
    readonly context: TContext;

    /**
     * Check if timer has elapsed.
     * @param name name of the timer in question
     * @returns boolean signaling its state
     */
    hasElapsedTimer(name: string | ProvideFunction<TContext, TDependencyMap>): boolean;

    /**
     * Check if timer is set.
     * @param name name of the timer in question
     * @returns boolean signalling availability
     */
    hasTimer(name: string | ProvideFunction<TContext, TDependencyMap>): boolean;
}

/**
 * Intermediate provider in case of chaining.
 */
export interface DependencyProvider<TContext extends BaseContext, TDependencyMap extends DependencyMap> {
    /**
     * Provide new dependency. Can be chained.
     * @param dependency dependency to be updated
     * @param newValue value which will be stored in the dependency
     */
    dependency<T>(dependency: Dependency<T>, newValue: T): DependencyProvider<TContext, TDependencyMap>;
    /**
     * Transition to next state
     */
    next(): ProvideComplete<TContext, TDependencyMap>;
    /**
     * Transition to previous state
     */
    previous(): ProvideComplete<TContext, TDependencyMap>;
    /**
     * Transition to state by name
     * @param name name of the next state or function it calls
     */
    transition(name: string | ProvideFunction<TContext, TDependencyMap>): ProvideComplete<TContext, TDependencyMap>;
}

export interface ProvideNothing<TContext extends BaseContext, TDependencyMap extends DependencyMap> {
    /**
     * Transition to itself -- repeat the state function
     */
    tryAgain(): ProvideComplete<TContext, TDependencyMap>;
    /**
     * Transition to next state
     */
    next(): ProvideComplete<TContext, TDependencyMap>;
    /**
     * Transition to previous state
     */
    previous(): ProvideComplete<TContext, TDependencyMap>;
    /**
     * Transition to state by name
     * @param name name of the next state or function it calls
     */
    transition(name: string | ProvideFunction<TContext, TDependencyMap>): ProvideComplete<TContext, TDependencyMap>;
}

/**
 * End provide chain
 */
export interface ProvideComplete<TContext extends BaseContext, TDependencyMap extends DependencyMap> {
    /**
     * Create new timer. Useful when it is not desirable perform WebElement click every state transition.
     * @param name new name of the timer
     * @param timeout time after timer will be in state 'elapsed'
     */
    createTimer(name: string | ProvideFunction<TContext, TDependencyMap>, timeout: number): ProvideComplete<TContext, TDependencyMap>;

    /**
     * Clear set timer with name.
     * @param name name of the timer
     */
    clearTimer(name: string | ProvideFunction<TContext, TDependencyMap>): ProvideComplete<TContext, TDependencyMap>;

    /**
     * Update context values. Make sure you are using immutable types. 
     * @param data which will take part in new context
     */
    updateContext(data: Partial<TContext>): ProvideComplete<TContext, TDependencyMap>;
}

export interface TimerData {
    name: string | ProvideFunction<never, never>,
    timeout: number
}

export interface ProvideData<TContext extends BaseContext, TDependencyMap extends DependencyMap> extends StateProvideData<TContext> {
    provider: State<TContext, TDependencyMap>,
}

export class Provide<TContext extends BaseContext, TDependencyMap extends DependencyMap> implements ProvidePublic<TContext, TDependencyMap>, DependencyProvider<TContext, TDependencyMap>, ProvideNothing<TContext, TDependencyMap>, ProvideComplete<TContext, TDependencyMap> {
    private _repeat: boolean;
    private _next: boolean;
    private _prev: boolean;
    private _nextStateName: string;
    private _updateMap: DependencyMap;
    private _createTimers: TimerData[];
    private _clearTimers: (string | ProvideFunction<never, never>)[];
    private _newContext: TContext;

    public constructor(private readonly config: ProvideData<TContext, TDependencyMap>) {
        this._repeat = false;
        this._prev = false;
        this._next = false;
        this._nextStateName = '';
        this._updateMap = {};
        this._clearTimers = [];
        this._createTimers = [];
        this._newContext = this.config.context;
    }

    public get context() : TContext {
        return this._newContext;
    }

    public get transitionState() : string {
        if (this._nextStateName === '') {
            throw new CriticalError('unexpected state');
        }

        return this._nextStateName;
    }

    
    public get newTimers() : typeof this._createTimers {
        return this._createTimers;
    }
    
    public get staleTimers() : typeof this._clearTimers {
        return this._clearTimers;
    }

    hasElapsedTimer(name: string | ProvideFunction<TContext, TDependencyMap>): boolean {
        const stringName = typeof name === 'string' ? name : name.name;
        return this.config.timers[stringName]?.elapsed(this.config.timeout);
    }

    hasTimer(name: string | ProvideFunction<TContext, TDependencyMap>): boolean {
        const stringName = typeof name === 'string' ? name : name.name;
        return this.config.timers[stringName] !== undefined;
    }

    createTimer(name: string | ProvideFunction<TContext, TDependencyMap>, timeout: number): ProvideComplete<TContext, TDependencyMap> {
        this._createTimers.push({name, timeout});
        return this;
    }

    clearTimer(name: string | ProvideFunction<TContext, TDependencyMap>): ProvideComplete<TContext, TDependencyMap> {
        this._clearTimers.push(name);
        return this;
    }

    updateContext(data: Partial<TContext>): ProvideComplete<TContext, TDependencyMap> {
        this._newContext = {
            ...this._newContext,
            ...data
        };
        return this;
    }
    
    public doesTransition(): boolean {
        return this._nextStateName !== '';
    }

    public doesRepeat() : boolean {
        return this._repeat;
    }

    public doesGoNext() : boolean {
        return this._next;
    }
    
    public doesGoPrevious() : boolean {
        return this._prev;
    }

    public get updateMap() : DependencyMap {
        return this._updateMap;
    }
    
    public tryAgain(): ProvideComplete<TContext, TDependencyMap> {
        this._repeat = true;
        return this;
    }

    public next(): ProvideComplete<TContext, TDependencyMap> {
        this._next = true;
        return this;
    }

    public previous(): ProvideComplete<TContext, TDependencyMap> {
        this._prev = true;
        return this;
    }

    public transition(name: string | ProvideFunction<TContext, TDependencyMap>): ProvideComplete<TContext, TDependencyMap> {
        this._nextStateName = typeof name === 'string' ? name : name.name;
        return this;
    }

    public nothing(): ProvideNothing<TContext, TDependencyMap> {
        return this;
    }

    public dependency<T>(dependency: Dependency<T>, newValue: T): DependencyProvider<TContext, TDependencyMap> {
        const dep = dependency as ValueDependency<T>;
        if (this.has(dep.id)) {
            throw new CriticalError(`Cannot provide dependency with id "${dep.id}" again.`);
        }

        const updatedDependency = dep.set(newValue, this.config.provider as unknown as State<never, never>);
        this._updateMap[updatedDependency.id] = updatedDependency;
        return this;
    }

    public has(id: DependencyID): boolean {
        return this._updateMap[id] !== undefined;
    }

    public get<T extends never>(id: DependencyID): Dependency<T> {
        const item = this._updateMap[id];

        if (item) {
            return item as T;
        }

        throw new CriticalError(`could not find dependency with name "${id}".`);
    }
}

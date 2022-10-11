import { State } from './State';
import { DependencyMap, DependencyID, FsmDependency, Dependency } from './Dependency';
import { CriticalError } from './Error';

export type ProvideFunction<T extends DependencyMap> = (provide: ProvidePublic, dependencies: T) => ProvideComplete | Promise<ProvideComplete>;

/**
 * Provide interface to provide required dependencies or nothing.
 */
export interface ProvidePublic {
    /**
     * Provide new dependency. Can be chained.
     * @param dependency dependency to be updated
     * @param newValue value which will be stored in the dependency
     */
    dependency<T>(dependency: Dependency<T>, newValue: T): DependencyProvider;
    /**
     * Nothing will be provided by this method.
     */
    nothing(): ProvideNothing;
}

/**
 * Intermediate provider in case of chaining.
 */
export interface DependencyProvider {
    /**
     * Provide new dependency. Can be chained.
     * @param dependency dependency to be updated
     * @param newValue value which will be stored in the dependency
     */
    dependency<T>(dependency: Dependency<T>, newValue: T): DependencyProvider;
    /**
     * Transition to next state
     */
    next(): ProvideComplete;
    /**
     * Transition to previous state
     */
    previous(): ProvideComplete;
    /**
     * Transition to state by name
     * @param name name of the next state or function it calls
     */
    transition(name: string | ProvideFunction<never>): ProvideComplete;
}

export interface ProvideNothing {
    /**
     * Transition to itself -- repeat the state function
     */
    tryAgain(): ProvideComplete;
    /**
     * Transition to next state
     */
    next(): ProvideComplete;
    /**
     * Transition to previous state
     */
    previous(): ProvideComplete;
    /**
     * Transition to state by name
     * @param name name of the next state or function it calls
     */
    transition(name: string | ProvideFunction<never>): ProvideComplete;
}

/**
 * End provide chain
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface ProvideComplete {}

export class Provide implements ProvidePublic, DependencyProvider, ProvideNothing, ProvideComplete {
    private _repeat: boolean;
    private _next: boolean;
    private _prev: boolean;
    private _nextStateName: string;
    private _updateMap: DependencyMap;

    public constructor(private readonly provider: State<never>) {
        this._repeat = false;
        this._prev = false;
        this._next = false;
        this._nextStateName = '';
        this._updateMap = {};
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

    
    public get transitionState() : string {
        if (this._nextStateName === '') {
            throw new CriticalError('unexpected state');
        }

        return this._nextStateName;
    }
    
    public tryAgain(): ProvideComplete {
        this._repeat = true;
        return this;
    }

    public next(): ProvideComplete {
        this._next = true;
        return this;
    }

    public previous(): ProvideComplete {
        this._prev = true;
        return this;
    }

    public transition(name: string | ProvideFunction<never>): ProvideComplete {
        this._nextStateName = typeof name === 'string' ? name : name.name;
        return this;
    }

    public nothing(): ProvideNothing {
        return this;
    }

    public dependency<T>(dependency: Dependency<T>, newValue: T): DependencyProvider {
        const dep = dependency as FsmDependency<T>;
        if (this.has(dep.id)) {
            throw new CriticalError(`Cannot provide dependency with id "${dep.id}" again.`);
        }

        const updatedDependency = dep.set(newValue, this.provider);
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

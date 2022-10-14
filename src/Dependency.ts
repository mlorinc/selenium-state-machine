import { error } from 'selenium-webdriver';
import { CriticalError } from './Error';
import { State } from './State';

/**
 * Dependency name type
 */
export type DependencyID = string;

/**
 * Dependency map generic type
 */
export type DependencyMap = {
    [key: string]: Dependency<unknown>
};

export interface FsmDependencyArguments<T> {
    name?: string;
    value?: T;
}

export interface FsmDependencyCloneArguments<T> {
    name?: string;
    provider: State<never, never>
    value?: T;
}

/**
 * Stale dependency has become stale. It extends StaleElementReferenceError but it tracks which
 * element is stale.
 */
export class StaleDependencyReferenceError<T> extends error.StaleElementReferenceError {
    constructor(public readonly dependency: ValueDependency<T>) {
        super();
    }
}

/**
 * Dependency interface
 */
export interface Dependency<T> {
    /**
     * Stored value
     */
    readonly value: T;
    /**
     * Name of the dependency
     */
    name: string;
    /**
     * Make dependency invalid/stale
     */
    invalidate(): never;
}

/**
 * Generic dependency type.
 */
export class ValueDependency<T> implements Dependency<T> {
    protected _value?: T;
    protected _name?: string;
    protected _provider?: State<never, never>;
    
    constructor(config?: FsmDependencyArguments<T>) {
        this._value = config?.value;
        this._name = config?.name;
        this.invalidate = this.invalidate.bind(this);
    }

    public invalidate(): never {
        this._value = undefined;
        throw new StaleDependencyReferenceError(this);
    }

    /**
     * Get who provides the dependency.
     */
    public get provider() : State<never, never> {
        if (this._provider === undefined) {
            throw new CriticalError(`provider of "${this.name}" is undefined.`);
        }

        return this._provider;
    }

    /**
     * Set new dependency provider. Must be first in invalid state before assigning.
     */
    public set provider(v: State<never, never>) {
        if (this._provider !== undefined) {
            throw new CriticalError(`provider cannot be set more than once, "${this.name}" has conflicting providers.`);
        }

        this._provider = v;
    }

    /**
     * Check if dependency is in ok state.
     */
    public get ready() : boolean {
        return this.value !== undefined;
    }

    public get name() : string {
        if (this._name === undefined) {
            throw new CriticalError('dependency is missing name');
        }

        return this._name;
    }

    public set name(v : string) {
        this._name = v;
    }
    
    public get id(): DependencyID {
        return this.name;
    }

    public get value() : T {
        if (this._value === undefined) {
            throw new CriticalError(`${this._name ? `[${this._name}] ` : ''}dependency not set.`);
        }

        return this._value;
    }

    /**
     * Assign new value to dependency. This is immutable method.
     * @param value new value
     * @param provider new provider
     * @returns new Dependency with new values
     */
    public set(value : T, provider: State<never, never>): ValueDependency<T> {
        return this.clone({value, provider});
    }

    /**
     * Make clone of the dependency.
     * @param newValues optional new values
     * @returns new Dependency
     */
    protected clone(newValues: FsmDependencyCloneArguments<T>): ValueDependency<T> {
        const dep = new ValueDependency<T>({
            name: newValues?.name ?? this._name,
            value: newValues?.value ?? this._value
        });
        dep.provider = newValues.provider;
        return dep;
    }
}

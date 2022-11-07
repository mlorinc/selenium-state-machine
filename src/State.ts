import winston = require('winston');
import { DependencyMap } from './Dependency';
import { CriticalError } from './Error';
import { Provide, ProvideComplete, ProvidePublic } from './Provide';
import { BaseContext } from './StateMachine';
import { Timer } from './Timer';

export interface StateProvideData<TContext extends BaseContext> {
    context: TContext,
    logger: winston.Logger,
    timers: {[name: string]: Timer},
    timeout: number
}

/**
 * Definition of state arguments.
 * @param f State functions which is called each tick. The function must return ProvideComplete object by using given DSL.
 * In case no dependencies are provides, use provide.nothing() otherwise use provide.dependency(dependencyObject, value).
 * After that select one of next, previous or transition. If nothing was provides tryAgain is available. Depending on selected option
 * the state machine will perform transition to next/previous/selected state or repeat itself.
 * @param name name of the state
 * @param timeout timeout on the state
 * @returns self
 */
export interface StateData<TContext extends BaseContext, TDependencyMap extends DependencyMap> {
    f: (provide: ProvidePublic<TContext, TDependencyMap>, dependencies: TDependencyMap) => Promise<ProvideComplete<TContext, TDependencyMap>> | ProvideComplete<TContext, TDependencyMap>;
    name?: string;
    timeout?: number;
}

export class State<TContext extends BaseContext, TDependencyMap extends DependencyMap> {
    constructor(private config: StateData<TContext, TDependencyMap>, public readonly index: number, private readonly provideConfig: StateProvideData<TContext>) {
    }
    
    /**
     * State timeout. If it is reached, error is threw.
     */
    public get timeout() : number {
        return this.config.timeout ?? Number.POSITIVE_INFINITY;
    }
    
    /**
     * Get state name
     */
    public get name() : string {
        return this.config.name ?? this.config.f.name;
    }
    
    /**
     * Call the state function.
     * @param dependencies provided dependencies so far
     * @returns provide object
     */
    async execute(dependencies: TDependencyMap): Promise<Provide<TContext, TDependencyMap>> {
        const provide = new Provide({
            provider: this,
            ...this.provideConfig
        });
        const result = await this.config.f(provide, dependencies) as Provide<TContext, TDependencyMap>;

        if (result === undefined) {
            throw new CriticalError(`undefined was returned in "${this.config.f?.constructor.name}".`);
        }

        return result as Provide<TContext, TDependencyMap>;
    }
}


import { error, promise, WebElement } from 'selenium-webdriver';
import { State } from './State';
import { ValueDependency, FsmDependencyArguments, FsmDependencyCloneArguments } from './Dependency';
import { CriticalError } from './Error';

/**
 * Specialized dependency type for WebElement objects. This object is responsible for
 * handling stale state.
 */
export class WebElementDependency<T extends WebElement> extends ValueDependency<T> {
    constructor(config?: FsmDependencyArguments<T>) {
        super(config);
        this.invalidate = this.invalidate.bind(this);
        this._value = (this._value) ? (createWebElementProxy(this._value, this)) : (undefined);
    }

    public set(v: T, provider: State<never>): WebElementDependency<T> {
        return this.clone({value: createWebElementProxy(v, this), provider});
    }

    public get value() : T {
        if (this._value === undefined) {
            throw new CriticalError(`${this._name ? `[${this._name}] ` : ''}WebElementDependency not set.`);
        }

        return this._value;
    }

    protected clone(newValues: FsmDependencyCloneArguments<T>): WebElementDependency<T> {
        const dep = new WebElementDependency<T>({
            name: newValues?.name ?? this._name,
            value: newValues?.value ?? this._value
        });
        dep.provider = newValues.provider;
        return dep;
    }
}

function createWebElementProxy<TComponent extends WebElement>(element: TComponent, dependency: WebElementDependency<TComponent>): TComponent {
    if (Object.getPrototypeOf(element)?.proxyed) {
        return element;
    }
  
    const proxy = new Proxy(element, {
        get(target, prop: PropertyKey, receiver) {
            const value = target[prop as keyof typeof target];
      
            if (value instanceof Function) {
                return function (this: WebElement, ...args: never[]) {
                    try {
                        const result = value.apply(this === receiver ? target : this, args);
                        if (promise.isPromise(result) && 'catch' in result) {
                            return result.catch((e: unknown) => {
                                if (e instanceof error.StaleElementReferenceError) {
                                    dependency.invalidate();
                                }
                                throw e;
                            });
                        }
                    }
                    catch (e) {
                        if (e instanceof error.StaleElementReferenceError) {
                            dependency.invalidate();
                        }
                        throw e;
                    }
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    });

    const prototype = Object.getPrototypeOf(proxy);
    prototype.proxyed = true;
    return proxy;
}
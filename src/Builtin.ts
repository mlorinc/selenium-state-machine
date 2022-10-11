import { WebElement } from 'selenium-webdriver';
import { StateData } from './State';
import { CriticalError } from './Error';
import { WebElementDependency } from './WebElementDependency';
import { DependencyMap, StaleDependencyReferenceError } from './Dependency';

/**
 * Wait state for interactivity
 * @param dependency name of the dependency to be checked
 * @param timeout timeout in ms
 * @returns StateData
 */
export function waitInteractive<TDependencyMap extends DependencyMap>(dependency: string, timeout?: number): StateData<TDependencyMap> {
    return {
        f: async (provide, dependencies) => {
            const dep = dependencies[dependency];
            if (dep instanceof WebElementDependency<WebElement> && dep.value instanceof WebElement) {
                if (await dep.value.isDisplayed() && await dep.value.isEnabled()) {
                    return provide.nothing().next();
                }
                else {
                    return provide.nothing().tryAgain();
                }
            }
            else if (dep === undefined) {
                throw new CriticalError(`unknown dependency: "${dependency}"`);
            }
            else {
                throw new CriticalError(`"${dependency}" is not WebElement dependency`);
            }
        },
        timeout
    };
}

/**
 * Wait until dependency is stale.
 * @param dependency dependency to be checked
 * @param timeout timeout in ms
 * @returns StateData
 */
export function waitStale<TDependencyMap extends DependencyMap>(dependency: string, timeout?: number): StateData<TDependencyMap> {
    return {
        f: async (provide, dependencies) => {
            const dep = dependencies[dependency];
            if (dep instanceof WebElementDependency<WebElement>) {
                try {
                    await dep.value.isDisplayed();
                    return provide.nothing().tryAgain();
                }
                catch (e) {
                    if (e instanceof StaleDependencyReferenceError) {
                        return provide.nothing().next();
                    }
                    throw e;
                }
            }
            else if (dep === undefined) {
                throw new CriticalError(`unknown dependency: "${dependency}"`);
            }
            else {
                throw new CriticalError(`"${dependency}" is not WebElement dependency`);
            }
        },
        timeout
    };
}

/**
 * Wait until dependency is not displayed or becomes stale.
 * @param dependency name of the dependency
 * @param timeout timeout in ms
 * @returns StateData
 */
export function waitDisappear<TDependencyMap extends DependencyMap>(dependency: string, timeout?: number): StateData<TDependencyMap> {
    return {
        f: async (provide, dependencies) => {
            const dep = dependencies[dependency];
            if (dep instanceof WebElementDependency<WebElement>) {
                try {
                    if(await dep.value.isDisplayed() === false) {
                        return provide.nothing().next();
                    }
                    return provide.nothing().tryAgain();
                }
                catch (e) {
                    if (e instanceof StaleDependencyReferenceError) {
                        return provide.nothing().next();
                    }
                    throw e;
                }
            }
            else if (dep === undefined) {
                throw new CriticalError(`unknown dependency: "${dependency}"`);
            }
            else {
                throw new CriticalError(`"${dependency}" is not WebElement dependency`);
            }
        },
        timeout
    };
}
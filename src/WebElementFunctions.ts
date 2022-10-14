import { error, WebElement } from 'selenium-webdriver';
import { StateData } from './State';
import { CriticalError } from './Error';
import { WebElementDependency } from './WebElementDependency';
import { DependencyMap, StaleDependencyReferenceError } from './Dependency';

/**
 * Check if element is stale
 * @param element WebElement or WebElementDependency 
 * @returns true if stale
 */
export async function isStale(element: WebElement | WebElementDependency<WebElement>): Promise<boolean> {
    try {
        const el = element instanceof WebElement ? element : element.debugElement;
        if (el === undefined) {
            return true;
        }
        await el.isDisplayed();
        return false;
    }
    catch (e) {
        if (e instanceof error.StaleElementReferenceError) {
            return true;
        }
        throw e;
    }
}

/**
 * Check if element is displayed or part of DOM
 * @param element WebElement or WebElementDependency 
 * @returns true if the element is present
 */
export async function isAvailable(element: WebElement | WebElementDependency<WebElement>): Promise<boolean> {
    try {
        const el = element instanceof WebElement ? element : element.debugElement;
        if (el === undefined) {
            return false;
        }
        return await el.isDisplayed();
    }
    catch (e) {
        if (e instanceof error.StaleElementReferenceError) {
            return false;
        }
        throw e;
    }
}

/**
 * Check if element is interactive
 * @param element WebElement or WebElementDependency 
 * @returns true if element is displayed and enabled
 */
export async function isInteractive(element: WebElement | WebElementDependency<WebElement>): Promise<boolean> {
    try {
        const el = element instanceof WebElement ? element : element.debugElement;
        if (el === undefined) {
            return false;
        }
        return await el.isDisplayed() && await el.isEnabled();
    }
    catch (e) {
        if (e instanceof error.StaleElementReferenceError) {
            return false;
        }
        throw e;
    }
}

/**
 * Wait state for interactivity
 * @param dependency name of the dependency to be checked
 * @param timeout timeout in ms
 * @returns StateData
 */
export function waitInteractive<TDependencyMap extends DependencyMap>(dependency: string, timeout?: number): StateData<never, TDependencyMap> {
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
export function waitStale<TDependencyMap extends DependencyMap>(dependency: string, timeout?: number): StateData<never, TDependencyMap> {
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
export function waitDisappear<TDependencyMap extends DependencyMap>(dependency: string, timeout?: number): StateData<never, TDependencyMap> {
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
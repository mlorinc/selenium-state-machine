# The Selenium state machine

The Selenium state machine project was created to tackle problems when testing Visual Studio Code extensions
using [vscode-extension-tester](https://github.com/redhat-developer/vscode-extension-tester).
The problem is some VS Code elements change a lot and become stale after some time which
causes flaky behavior in user interface tests. And it is relatively easy to fix one
needs to refetch element again. However when multiple elements are involved the code
becomes harder to maintain. Thats where state machines come to play and are handy in
solving the problem.

## Install

The library can be downloaded from npm registry using:

```
npm i selenium-state-machine
```

And then just import it to your code and follow usage section.

## Usage

First declare your dependencies. Dependencies are basically shared values, in this case WebElements.
If you need to use some element in multiple states you should definitely declare them as dependency.
These dependencies are also protected when StaleElementReferenceError is thrown.

```js
const dependencies = declareDependencies({
    'body': new WebElementDependency<BodyPageObject>(),
    'heading': new WebElementDependency<HeadingPageObject>(),
    etc...
});
```

After that state machine must be created.

```js
const sm = new StateMachine({ timeout }, dependencies);
```

Then define some state functions which are compatible with the following function:

```js
async function openFile(provide: ProvidePublic, {here select which dependencies you want to use, body}: typeof dependecies): Promise<ProvideComplete> {
    ...
    return provide.dependency(body, new WebElement(By.css('body'))).next();
}
```

At last add your state function to state machine. Order in which functions are added is important!

```js
sm.state(openFile);
sm.state('customName', someFn);

// You can now start the state machine
await sm.start();
```

## Roadmap

1. Add the most used code snippets
2. Iron out all the bugs
3. Apply QoL features based on experience
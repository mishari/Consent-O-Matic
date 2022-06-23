class Action {
    static createAction(config, cmp) {
        try {
            switch (config.type) {
                case "click": return new ClickAction(config, cmp);
                case "list": return new ListAction(config, cmp);
                case "consent": return new ConsentAction(config, cmp);
                case "ifcss": return new IfCssAction(config, cmp);
                case "waitcss": return new WaitCssAction(config, cmp);
                case "foreach": return new ForEachAction(config, cmp);
                case "hide": return new HideAction(config, cmp);
                case "slide": return new SlideAction(config, cmp);
                case "close": return new CloseAction(config, cmp);
                case "wait": return new WaitAction(config, cmp);
                case "ifallowall": return new IfAllowAllAction(config, cmp);
                default: throw "Unknown action type: " + config.type;
            }
        } catch (e) {
            console.error(e);
            return new NopAction(config, cmp);
        }
    }

    constructor(config) {
        const self = this;

        this.config = config;

        if(ConsentEngine.debugValues.debugLog) {
            //Override execute, with logging variant
            let realExecute = this.execute;

            this.execute = async function (param) {
                self.logStart(param);
                try {
                    await realExecute.call(self, param);
                } catch (e) {
                    console.error(e);
                }
                self.logEnd();
            }
        }
    }

    get timeout() {
        if (this.config.timeout != null) {
            return this.config.timeout;
        } else {
            let pipEnabled = ConsentEngine.debugValues.skipHideMethod === false && ConsentEngine.debugValues.hideInsteadOfPIP === false;

            if (ConsentEngine.debugValues.clickDelay) {
                return 125;
            } else if(ConsentEngine.singleton.pipEnabled) {
                return 125;
            } else {
                return 0;
            }
        }
    }

    logStart(param) {
        if (ConsentEngine.debugValues.debugLog) {
            console.group(this.constructor.name + ":", this.config, param);
        }
    }

    logEnd() {
        if (ConsentEngine.debugValues.debugLog) {
            console.groupEnd();
        }
    }

    async execute(param) {
        console.log("Remember to overrride execute()", this.constructor.name);
    }

    async waitTimeout(timeout) {
        return new Promise((resolve) => {
            setTimeout(() => { resolve(); }, timeout);
        });
    }

    getNumSteps() {
        console.warn("Missing getNumSteps on: "+this.constructor.name);
        return 0;
    }
}

class ListAction extends Action {
    constructor(config, cmp) {
        super(config);

        this.actions = [];
        config.actions.forEach((actionConfig) => {
            this.actions.push(Action.createAction(actionConfig, cmp));
        });
    }

    async execute(param) {
        for (let action of this.actions) {
            await action.execute(param);
        }
    }

    getNumSteps() {
        let steps = 0;

        this.actions.forEach((action)=>{
            steps += action.getNumSteps();
        });

        return steps;
    }
}

class CloseAction extends Action {
    constructor(config, cmp) {
        super(config);
    }

    async execute(param) {
        window.close();
        return 1; // Closing window counts as a click
    }

    getNumSteps() {
        return 1;
    }
}

class WaitAction extends Action {
    constructor(config, cmp) {
        super(config);
    }

    async execute(param) {
        let self = this;
        await new Promise((resolve, reject) => {
            setTimeout(() => { resolve() }, self.config.waitTime);
        });
    }

    getNumSteps() {
        return 1;
    }
}

class ClickAction extends Action {
    constructor(config, cmp) {
        super(config);
        this.cmp = cmp;
    }

    async execute(param) {
        let result = Tools.find(this.config);

        if (result.target != null) {
            let pipScroll = false;
            if(ConsentEngine.singleton.pipEnabled) {
                pipScroll = result.target.closest(".ConsentOMatic-CMP-PIP") != null;
            }
    
            if (ConsentEngine.debugValues.clickDelay || pipScroll) {
                //Wait for any auto scroll to finish
                let scrollPromise = new Promise((resolve)=>{
                    let scrollTimeout = null;
                    
                    function myTimeout() {
                        scrollTimeout = setTimeout(()=>{
                            window.removeEventListener("scroll", myScroll);
                            resolve();
                        }, 25);
                    }

                    function myScroll() {
                        clearTimeout(scrollTimeout);
                        myTimeout();
                    }

                    myTimeout();
                    window.addEventListener('scroll', myScroll);
                });

                result.target.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                    inline: "center"
                });

                await scrollPromise;
            }

            await this.waitTimeout(this.timeout);

            if (ConsentEngine.debugValues.debugClicks) {
                console.log("Clicking: [openInTab: " + this.config.openInTab + "]", result.target);
            }

            if (ConsentEngine.debugValues.clickDelay || pipScroll) {
                result.target.focus({ preventScroll: true });
            }

            if (this.config.openInTab) {
                //Handle osx behaving differently?
                result.target.dispatchEvent(new MouseEvent("click", { ctrlKey: true, shiftKey: true }));
            } else {
                result.target.click();
            }

            ConsentEngine.singleton.registerClick();
        }

        await this.waitTimeout(this.timeout);
    }

    getNumSteps() {
        return 1;
    }
}

class ConsentAction extends Action {
    constructor(config, cmp) {
        super(config);

        let self = this;

        this.consents = [];

        this.config.consents.forEach((consentConfig) => {
            self.consents.push(new Consent(consentConfig, cmp));
        });
    }

    async execute(consentTypes) {
        for (let consent of this.consents) {
            let shouldBeEnabled = false;

            if (consentTypes.hasOwnProperty(consent.type)) {
                shouldBeEnabled = consentTypes[consent.type];
            }

            await consent.setEnabled(shouldBeEnabled);
        }
    }

    getNumSteps() {
        return 1;
    }
}

class IfCssAction extends Action {
    constructor(config, cmp) {
        super(config);

        if (config.trueAction != null) {
            this.trueAction = Action.createAction(config.trueAction, cmp);
        }

        if (config.falseAction != null) {
            this.falseAction = Action.createAction(config.falseAction, cmp);
        }
    }

    async execute(param) {
        let result = Tools.find(this.config);

        if (result.target != null) {
            if (this.trueAction != null) {
                await this.trueAction.execute(param);
            }
        } else {
            if (this.falseAction != null) {
                await this.falseAction.execute(param);
            }
        }
    }

    getNumSteps() {
        let steps = 0;

        if(this.trueAction != null) {
            steps += this.trueAction.getNumSteps();
        }

        if(this.falseAction != null) {
            steps += this.falseAction.getNumSteps();
        }

        return Math.round(steps / 2);
    }
}

class WaitCssAction extends Action {
    constructor(config, cmp) {
        super(config);
    }

    async execute(param) {
        let self = this;
        let negated = false;

        if (self.config.negated) {
            negated = self.config.negated;
        }

        if (ConsentEngine.debugValues.debugLog) {
            console.time("Waiting [" + negated + "]:" + this.config.target.selector);
        }

        await new Promise((resolve) => {
            let numRetries = 10;
            let waitTime = 250;

            if (self.config.retries) {
                numRetries = self.config.retries;
            }

            if (self.config.waitTime) {
                waitTime = self.config.waitTime;
            }

            function checkCss() {
                let result = Tools.find(self.config);

                if (negated) {
                    if (result.target != null) {
                        if (numRetries > 0) {
                            numRetries--;
                            setTimeout(checkCss, waitTime);
                        } else {
                            if (ConsentEngine.debugValues.debugLog) {
                                console.timeEnd("Waiting [" + negated + "]:" + self.config.target.selector);
                            }
                            resolve();
                        }
                    } else {
                        if (ConsentEngine.debugValues.debugLog) {
                            console.timeEnd("Waiting [" + negated + "]:" + self.config.target.selector);
                        }
                        resolve();
                    }
                } else {
                    if (result.target != null) {
                        if (ConsentEngine.debugValues.debugLog) {
                            console.timeEnd("Waiting [" + negated + "]:" + self.config.target.selector);
                        }
                        resolve();
                    } else {
                        if (numRetries > 0) {
                            numRetries--;
                            setTimeout(checkCss, waitTime);
                        } else {
                            if (ConsentEngine.debugValues.debugLog) {
                                console.timeEnd("Waiting [" + negated + "]:" + self.config.target.selector);
                            }
                            resolve();
                        }
                    }
                }
            }

            checkCss();
        });
    }

    getNumSteps() {
        return 1;
    }
}

class NopAction extends Action {
    constructor(config, cmp) {
        super(config);
    }

    async execute(param) {
        //NOP
    }

    getNumSteps() {
        return 0;
    }
}

class ForEachAction extends Action {
    constructor(config, cmp) {
        super(config);

        this.action = Action.createAction(this.config.action, cmp);
    }

    async execute(param) {
        let results = Tools.find(this.config, true);
        let oldBase = Tools.base;

        for (let result of results) {
            if (result.target != null) {
                Tools.setBase(result.target);
                await this.action.execute(param);
            }
        }

        Tools.setBase(oldBase);
    }

    getNumSteps() {
        return this.action.getNumSteps();
    }
}

class HideAction extends Action {
    constructor(config, cmp) {
        super(config);
        this.cmp = cmp;
    }

    async execute(param) {
        if(ConsentEngine.debugValues.skipHideMethod === true) {
            return;
        }

        let self = this;
        let result = Tools.find(this.config);

        if (result.target != null) {
            this.cmp.hiddenTargets.push(result.target);

            if(this.config.hideFromDetection === true) {
                result.target.classList.add("ConsentOMatic-CMP-NoDetect");
            }

            if(ConsentEngine.debugValues.hideInsteadOfPIP || this.config.forceHide === true) {
                result.target.classList.add("ConsentOMatic-CMP-Hider");
            } else {
                ConsentEngine.singleton.enablePip();
                result.target.classList.add("ConsentOMatic-CMP-PIP");
                
                if(result.target.savedStyles == null) {
                    result.target.savedStyles = result.target.getAttribute("style");
                }

                function setStyles() {
                    let preview = document.querySelector(".ConsentOMatic-Progres-Preview");
                    let scale = 0.25;
                    if(preview != null) {
                        let width = preview.offsetWidth - 4;
                        let height = preview.offsetHeight - 4;
    
                        let targetWidth = result.target.offsetWidth;
                        let targetHeight = result.target.offsetHeight;
    
                        let widthScale = width / targetWidth;
                        let heightScale = height / targetHeight;
    
                        scale = Math.min(widthScale, heightScale);
                    }
    
                    //console.log("Setting styles:", result.target, scale, preview != null);

                    result.target.style.setProperty("position", "fixed", "important");
                    result.target.style.setProperty("left", "initial","important");
                    result.target.style.setProperty("top","initial","important");
                    result.target.style.setProperty("right",  "2px", "important");
                    result.target.style.setProperty("bottom", "2px", "important");
                    result.target.style.setProperty("transform", "translateY(-4rem) scale("+scale+")", "important");
                    result.target.style.setProperty("transform-origin", "right bottom", "important");
                    result.target.style.setProperty("transition", "transform 0.15s ease-in-out", "important");
                    result.target.style.setProperty("contain", "paint", "important");
                    result.target.style.setProperty("border", "none", "important");
                    result.target.style.setProperty("box-shadow", "none", "important");
                    result.target.style.setProperty("z-index", "2147483647", "important");
                    result.target.style.setProperty("animation", "none", "important");
                }

                setStyles();

                let entriesSeen = new Set();

                let observer = new ResizeObserver((entries)=>{
                    for(let entry of entries) {
                        if(!entriesSeen.has(entry.target)) {
                            entriesSeen.add(entry.target);
                        } else {
                            setStyles();
                        }
                    }
                });

                startObserver();

                function startObserver() {
                    entriesSeen.clear();
                    observer.observe(result.target);
                }

                this.cmp.observers.push(observer);

                let observer2 = new MutationObserver((mutations)=>{
                    setStyles();
                });

                this.cmp.observers.push(observer2);
                observer2.observe(result.target, {
                    attributes: true,
                    attributeFilter: ["style"]
                });
            }
        }
    }

    getNumSteps() {
        return 1;
    }
}

class SlideAction extends Action {
    constructor(config, cmp) {
        super(config);
        this.cmp = cmp;
    }

    async execute(param) {
        let result = Tools.find(this.config);

        let dragResult = Tools.find(this.config.dragTarget);

        if (result.target != null) {
            let targetBounds = result.target.getBoundingClientRect();
            let dragTargetBounds = dragResult.target.getBoundingClientRect();

            let yDiff = dragTargetBounds.top - targetBounds.top;
            let xDiff = dragTargetBounds.left - targetBounds.left;

            if (this.config.axis.toLowerCase() === "y") {
                xDiff = 0;
            }
            if (this.config.axis.toLowerCase() === "x") {
                yDiff = 0;
            }

            let screenX = window.screenX + targetBounds.left + targetBounds.width / 2.0;
            let screenY = window.screenY + targetBounds.top + targetBounds.height / 2.0;
            let clientX = targetBounds.left + targetBounds.width / 2.0;
            let clientY = targetBounds.top + targetBounds.height / 2.0;

            let mouseDown = document.createEvent("MouseEvents");
            mouseDown.initMouseEvent(
                "mousedown",
                true,
                true,
                window,
                0,
                screenX,
                screenY,
                clientX,
                clientY,
                false,
                false,
                false,
                false,
                0,
                result.target
            );

            let mouseMove = document.createEvent("MouseEvents");
            mouseMove.initMouseEvent(
                "mousemove",
                true,
                true,
                window,
                0,
                screenX + xDiff,
                screenY + yDiff,
                clientX + xDiff,
                clientY + yDiff,
                false,
                false,
                false,
                false,
                0,
                result.target
            );

            let mouseUp = document.createEvent("MouseEvents");
            mouseUp.initMouseEvent(
                "mouseup",
                true,
                true,
                window,
                0,
                screenX + xDiff,
                screenY + yDiff,
                clientX + xDiff,
                clientY + yDiff,
                false,
                false,
                false,
                false,
                0,
                result.target
            );

            result.target.dispatchEvent(mouseDown);
            await this.waitTimeout(10);
            result.target.dispatchEvent(mouseMove);
            await this.waitTimeout(10);
            result.target.dispatchEvent(mouseUp);
            ConsentEngine.singleton.registerClick();
        }
    }

    getNumSteps() {
        return 1;
    }
}

class IfAllowAllAction extends Action {
    constructor(config, cmp) {
        super(config);
        this.cmp = cmp;
 
        if (config.trueAction != null) {
            this.trueAction = Action.createAction(config.trueAction, cmp);
        }

        if (config.falseAction != null) {
            this.falseAction = Action.createAction(config.falseAction, cmp);
        }
    }

    async execute(consentTypes) {
        let allTrue = true;

        Object.keys(consentTypes).forEach((key)=>{
            let value = consentTypes[key];

            if(value === false) {
                allTrue = false;
            }
        });

        console.log("All True:", allTrue);

        if (allTrue) {
            if (this.trueAction != null) {
                await this.trueAction.execute(consentTypes);
            }
        } else {
            if (this.falseAction != null) {
                await this.falseAction.execute(consentTypes);
            }
        }
    }

    getNumSteps() {
        let steps = 0;

        if(this.trueAction != null) {
            steps += this.trueAction.getNumSteps();
        }

        if(this.falseAction != null) {
            steps += this.falseAction.getNumSteps();
        }

        return Math.round(steps / 2);
    }
}
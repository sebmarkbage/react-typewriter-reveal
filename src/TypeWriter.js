"use client";

import {
  createContext,
  createRef,
  useContext,
  useState,
  useRef,
  useLayoutEffect,
  useSyncExternalStore,
  createElement,
} from "react";

const TypeWriterContext = createContext(null);

// We arbitrarily treat content elements equivalent to 10 characters of text.
const CHARACTERS_PER_CONTENT_ELEMENT = 10;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function isContentElement(element) {
  // Elements that can be considered content in their own right and is
  // therefore one step by themselves.
  switch (element.nodeName) {
    case "IMG":
    case "SVG":
    case "VIDEO":
    case "CANVAS":
    case "IFRAME":
    case "EMBED":
    case "OBJECT":
    case "PICTURE":
    case "INPUT":
    case "TEXTAREA":
    case "SELECT":
    case "BUTTON":
    case "METER":
    case "PROGRESS":
      return true;
    default:
      const computedStyle = getComputedStyle(element);
      if (
        computedStyle.display === "inline" &&
        computedStyle.position === "static"
      ) {
        return false;
      }
      // If a block element renders its own styles, those can be outside the selected text
      // and we treat it as one unit.
      return (
        computedStyle.backgroundColor !== "rgba(0, 0, 0, 0)" ||
        computedStyle.backgroundImage !== "none" ||
        (computedStyle.borderColor !== "rgb(0, 0, 0)" &&
          computedStyle.borderWidth !== "0px" &&
          computedStyle.borderStyle !== "none") ||
        (computedStyle.outlineColor !== "rgb(0, 0, 0)" &&
          computedStyle.outlineWidth !== "0px" &&
          computedStyle.outlineStyle !== "none")
      );
  }
}

function getContentLength(element) {
  return element.textContent.length || CHARACTERS_PER_CONTENT_ELEMENT;
}

function isInvisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width === 0 || rect.height === 0;
}

function countSteps(element, end) {
  // Count how many potential steps we can break this node down into.
  let sum = 0;
  let node = element;
  while (true) {
    if (end !== undefined && node === end) {
      return sum;
    }
    if (node.nodeType === TEXT_NODE) {
      sum += node.nodeValue.length;
    } else if (node.nodeType === ELEMENT_NODE) {
      if (isInvisible(node)) {
        // This whole element is invisible. Don't consider it part of the content.
      } else if (
        isContentElement(node) &&
        // If we the end target is inside this node, then we need to drill into it.
        (end === undefined || !node.contains(end))
      ) {
        // We've consumed one step.
        sum += getContentLength(node);
      } else if (node.firstChild !== null) {
        node = node.firstChild;
        continue;
      }
    }
    // Move onto the next node.
    while (node.nextSibling === null) {
      if (node.parentNode === null || node.parentNode === element) {
        // We reached back up to the element.
        return sum;
      }
      node = node.parentNode;
    }
    node = node.nextSibling;
  }
  return sum;
}

function selectNextRange(range, stepsToMove) {
  // Continuing from where we last left off.
  let container = range.endContainer;
  let offset = range.endOffset;
  // Collapse to the end.
  range.setStart(container, offset);
  if (offset > 0 && stepsToMove > 0 && container.nodeType !== TEXT_NODE) {
    if (offset >= container.childNodes.length) {
      // Skip to next child.
      while (container.nextSibling === null) {
        if (container.parentNode === null) {
          offset = 0;
          range.setEnd(container, offset);
          return;
        }
        container = container.parentNode;
      }
      container = container.nextSibling;
      offset = 0;
    } else {
      // Jump inside the selected node.
      container = container.childNodes[offset];
      offset = 0;
    }
  }
  while (stepsToMove > 0) {
    if (container.nodeType === TEXT_NODE) {
      const textRemaining = container.nodeValue.length - offset;
      if (textRemaining >= stepsToMove) {
        offset += stepsToMove;
        stepsToMove = 0;
        break;
      } else {
        stepsToMove -= textRemaining;
      }
    } else if (container.nodeType === ELEMENT_NODE) {
      if (isInvisible(container)) {
        // Invisible doesn't get consumed. Move onto the next one.
      } else if (isContentElement(container)) {
        // We've consumed one step.
        stepsToMove -= getContentLength(container);
        if (stepsToMove <= 0) {
          // Make the selection after the current element.
          range.setEndAfter(container);
          return -stepsToMove;
        }
      } else if (container.firstChild !== null) {
        container = container.firstChild;
        continue;
      }
    }
    // Move onto the next node.
    while (container.nextSibling === null) {
      if (container.parentNode === null) {
        offset = 0;
        range.setEnd(container, offset);
        return -stepsToMove;
      }
      container = container.parentNode;
    }
    container = container.nextSibling;
    offset = 0;
  }
  range.setEnd(container, offset);
  return -stepsToMove;
}

function animate(
  rootInstance,
  instance,
  element,
  caretElement,
  duration,
  fps,
  delay
) {
  const stepsWithinElement = countSteps(element);
  instance.totalSteps = stepsWithinElement;
  const rootElement = rootInstance.elementRef.current;
  const stepsUntilStart =
    rootElement === element ? 0 : countSteps(rootElement, element);
  const stepsWithinRoot = rootInstance.totalSteps;

  if (rootInstance.stepsCompleted >= stepsUntilStart + stepsWithinElement) {
    // We have already completed further than this whole element. Nothing to animate.
    return;
  }

  // Next we'll compute how much progress we've already made along the root.
  let progress;
  const runningRootAnimation = rootInstance.runningAnimation;
  if (
    runningRootAnimation !== null &&
    runningRootAnimation.currentTime !== null
  ) {
    // We're currently running the root and we've made some additional progress.
    const timing = runningRootAnimation.effect.getComputedTiming();
    progress =
      (runningRootAnimation.currentTime - timing.delay) / timing.activeDuration;
  } else {
    progress = rootInstance.stepsCompleted / rootInstance.totalSteps;
  }
  const startTime = rootInstance.duration * progress;

  // Add a delay until the root animation's steps have reached us.
  delay += (duration * stepsUntilStart) / stepsWithinRoot;
  // Adjust the duration based on the slice of the root duration we occupy.
  duration *= stepsWithinElement / stepsWithinRoot;

  if (startTime >= delay + duration) {
    // We are starting after we should be finished. Skip the animation.
    return;
  }

  const frameCount = Math.floor((duration * fps) / 1000);
  if (frameCount < 2) {
    console.warn("TypeWriter duration or fps is too small.");
    return;
  }

  const keyframes = [];
  const caretTranslateKeyframes = [];
  const caretOpacityKeyframes = [];
  const range = document.createRange();
  range.setStart(element, 0);
  range.setEnd(element, 0);

  if (rootInstance.stepsCompleted >= stepsUntilStart + stepsWithinElement) {
    // We have already completed further than this whole element. Nothing to animate.
    return;
  }

  let currentStep = 0;
  const elementRects = element.getClientRects();
  if (elementRects.length !== 1) {
    console.error("TypeWriter expects a block element as its root.");
    return;
  }
  const referenceRect = elementRects[0];
  if (referenceRect.width === 0 || referenceRect.height === 0) {
    // Currently invisible. No need to animate.
    return;
  }
  let caretReferenceRect = null;
  let lastRect = null;
  if (caretElement != null) {
    const range = document.createRange();
    range.selectNodeContents(caretElement);
    // Measure the size of the contents. Allowing us to get the line-height.
    const caretElementRects = range.getClientRects();
    if (caretElementRects.length > 0) {
      caretReferenceRect = caretElementRects[0];
    }
  }
  let path = "";
  const stepsPerFrame = stepsWithinElement / frameCount;
  for (let i = 0; i < frameCount; i++) {
    // We compute the steps move based on where we are and where we should
    // be so that we spread out the number of steps through the sequence.
    const stepWeShouldBeAt = stepsPerFrame * i;
    const stepsToMove = Math.round(stepWeShouldBeAt - currentStep);
    const overshoot = selectNextRange(range, stepsToMove);
    const rects = range.getClientRects();
    for (let j = 0; j < rects.length; j++) {
      const rect = rects[j];
      if (rect.width === 0 || rect.height === 0) {
        continue;
      }
      const x = rect.x - referenceRect.x;
      const y = rect.y - referenceRect.y;
      const w = rect.width;
      const h = rect.height;
      path += "M " + x + " " + y + " h " + w + " v " + h + " H " + x + " Z";
      lastRect = rect;
    }
    keyframes.push(path === "" ? "polygon(0 0)" : 'path("' + path + '")');
    if (caretReferenceRect) {
      if (lastRect === null || range.endContainer.nodeType !== TEXT_NODE) {
        caretOpacityKeyframes.push("0");
        caretTranslateKeyframes.push("none");
      } else {
        const caretX = lastRect.right - caretReferenceRect.x;
        const caretY = lastRect.bottom - caretReferenceRect.bottom;
        caretOpacityKeyframes.push("1");
        caretTranslateKeyframes.push(caretX + "px " + caretY + "px");
      }
    }
    currentStep += stepsToMove + overshoot;
  }

  const easing = "steps(" + (frameCount - 1) + ", end)";
  const fill = "backwards";

  // Start the animtion
  const elementAnimation = element.animate(
    {
      clipPath: keyframes,
    },
    {
      delay,
      duration,
      easing,
      fill,
    }
  );
  if (startTime > 0) {
    elementAnimation.currentTime = startTime;
  }
  instance.runningToSteps = stepsWithinElement;
  instance.runningAnimation = elementAnimation;
  if (caretElement !== null && caretReferenceRect !== null) {
    const caretAnimation = caretElement.animate(
      {
        opacity: caretOpacityKeyframes,
        translate: caretTranslateKeyframes,
      },
      {
        delay,
        duration,
        easing,
        fill,
      }
    );
    if (startTime > 0) {
      caretAnimation.currentTime = startTime;
    }
    instance.runningCaretAnimation = caretAnimation;
  } else {
    instance.runningCaretAnimation = null;
  }
}

function subscribeToStore() {
  // noop
}

function getServerSnapshot() {
  return true;
}

function observeResize(instance) {
  if (instance.ignoreInitialResize) {
    instance.ignoreInitialResize = false;
  } else {
    attemptAnimation(instance);
  }
}

function observeMutation(instance) {
  // Force a resize event to happen. We do this to avoid having to trigger
  // two events if there's both a mutation and resize. That way we always
  // reliably animate in the resize callback.
  const element = instance.elementRef.current;
  const resizeObserver = instance.resizeObserver;
  resizeObserver.unobserve(element);
  resizeObserver.observe(element);
}

function createTypeWriterInstance() {
  const instance = {
    parent: null,
    children: [],
    elementRef: createRef(null),
    caretRef: createRef(null),
    duration: 300,
    fps: 60,
    delay: 0,
    totalSteps: 0,
    stepsCompleted: 0,
    runningToSteps: 0,
    runningAnimation: null,
    runningCaretAnimation: null,
    mutationObserver: null,
    resizeObserver: null,
    ignoreInitialResize: false,
  };
  if (
    typeof MutationObserver === "function" &&
    typeof ResizeObserver === "function"
  ) {
    instance.mutationObserver = new MutationObserver(
      observeMutation.bind(null, instance)
    );
    instance.resizeObserver = new ResizeObserver(
      observeResize.bind(null, instance)
    );
  }
  return instance;
}

function attemptAnimation(instance) {
  // Restart
  const runningAnimation = instance.runningAnimation;
  if (runningAnimation !== null) {
    instance.runningAnimation = null;
    const stopTime = runningAnimation.currentTime;
    if (stopTime !== null) {
      const timing = runningAnimation.effect.getComputedTiming();
      const overallProgress = (stopTime - timing.delay) / timing.activeDuration;
      if (overallProgress > 0) {
        // We made some progress. Let's update how many steps we've completed.
        instance.stepsCompleted = instance.runningToSteps * overallProgress;
      }
    }
    runningAnimation.cancel();
  }
  if (instance.runningCaretAnimation !== null) {
    instance.runningCaretAnimation.cancel();
    instance.runningCaretAnimation = null;
  }
  const element = instance.elementRef.current;
  const caretElement = instance.caretRef.current;
  if (!element) {
    return;
  }
  let animatingRoot = instance;
  while (
    animatingRoot.parent !== null &&
    animatingRoot.parent.runningAnimation !== null
  ) {
    animatingRoot = animatingRoot.parent;
    const parentElement = animatingRoot.elementRef.current;
    if (parentElement === null) {
      console.error(
        "Did not expect a parentElement to be missing if scheduled."
      );
      return;
    }
  }
  animate(
    animatingRoot,
    instance,
    element,
    caretElement,
    animatingRoot.duration,
    instance.fps,
    instance.delay
  );
}

export default function TypeWriter({
  children,
  fps = 60,
  duration = 300,
  delay = 0,
  caret,
}) {
  const parentInstance = useContext(TypeWriterContext);
  const [instance] = useState(createTypeWriterInstance);

  const wasSSR = useRef(false);
  const isSSR = useSyncExternalStore(
    subscribeToStore,
    () => wasSSR.current,
    getServerSnapshot
  );
  // This avoids rerendering after hydration since it'll be consistently wasSSR after this.
  wasSSR.current = isSSR;

  useLayoutEffect(() => {
    // This is the duration that will be used to coordinate children as they animate.
    instance.duration = duration;
    instance.fps = fps;
    instance.delay = delay;
  }, [duration, delay, fps]);

  useLayoutEffect(() => {
    if (parentInstance !== null) {
      instance.parent = parentInstance;
      const parentChildren = parentInstance.children;
      parentChildren.push(instance);
    }

    const element = instance.elementRef.current;
    if (element !== null) {
      instance.mutationObserver.observe(element, {
        subtree: true,
        childList: true,
        attributeFilter: ["class", "style", "src"],
      });
      // If we're hydrating, it's too late to run the animation.
      // We have already painted the content. We'll ignore the initial resize event
      // and then listen to future changes.
      instance.ignoreInitialResize = wasSSR.current;
      // This will trigger an initial event which will start the mount animation.
      instance.resizeObserver.observe(element);
    }

    return () => {
      instance.mutationObserver.disconnect();
      instance.resizeObserver.disconnect();
      // Remove ourselves from the parent.
      if (parentInstance !== null) {
        instance.parent = null;
        const parentChildren = parentInstance.children;
        const idx = parentChildren.indexOf(instance);
        if (idx !== -1) {
          parentChildren.splice(idx, 1);
        }
      }
      const runningAnimation = instance.runningAnimation;
      if (runningAnimation !== null) {
        instance.runningAnimation = null;
        runningAnimation.cancel();
      }
      const runningCaretAnimation = instance.runningCaretAnimation;
      if (runningCaretAnimation !== null) {
        instance.runningCaretAnimation = null;
        runningCaretAnimation.cancel();
      }
    };
  }, [parentInstance, instance]);

  return createElement(
    TypeWriterContext.Provider,
    { value: instance },
    createElement(
      "span",
      {
        ref: instance.elementRef,
        style: {
          // The reason we need an inline-block element or block element as the root
          // is because clip-path's reference frame is not standardized for inline
          // elements and browsers differ in how they implement it.
          display: "inline-block",
        },
      },
      children
    ),
    caret != null
      ? createElement(
          "span",
          {
            ref: instance.caretRef,
            style: { position: "absolute", opacity: 0, pointerEvents: "none" },
          },
          caret
        )
      : null
  );
}

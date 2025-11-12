"use client";

import {
  createContext,
  createRef,
  useContext,
  useState,
  useRef,
  useLayoutEffect,
  useSyncExternalStore,
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
          computedStyle.borderWidth !== "0px") ||
        (computedStyle.outlineColor !== "rgb(0, 0, 0)" &&
          computedStyle.outlineWidth !== "0px")
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
      } else if (container.firstChild !== null) {
        container = container.firstChild;
        continue;
      }
    }
    // Move onto the next node.
    while (container.nextSibling === null) {
      if (container.parentNode === null) {
        range.setEnd(container, offset);
        return;
      }
      container = container.parentNode;
    }
    container = container.nextSibling;
    offset = 0;
  }
  range.setEnd(container, offset);
  return -stepsToMove;
}

function animate(rootElement, element, caretElement, duration, fps, delay) {
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
  const stepsWithinElement = countSteps(element);
  const stepsUntilStart =
    rootElement === element ? 0 : countSteps(rootElement, element);
  const stepsWithinRoot =
    rootElement === element ? stepsWithinElement : countSteps(rootElement);
  const stepsPerFrame = countSteps(element) / frameCount;

  // Add a delay until the root animation's steps have reached us.
  delay += (duration * stepsUntilStart) / stepsWithinRoot;
  // Adjust the duration based on the slice of the root duration we occupy.
  duration *= stepsWithinElement / stepsWithinRoot;

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
    return () => {
      elementAnimation.cancel();
      caretAnimation.cancel();
    };
  } else {
    return () => {
      elementAnimation.cancel();
    };
  }
}

function subscribeToStore() {
  // noop
}

function getServerSnapshot() {
  return true;
}

function createTypeWriterInstance() {
  return {
    parent: null,
    children: [],
    elementRef: createRef(null),
    caretRef: createRef(null),
    duration: 300,
    fps: 60,
    delay: 0,
    scheduled: false,
    runningAnimation: null,
  };
}

function attemptAnimation(instance) {
  const element = instance.elementRef.current;
  const caretElement = instance.caretRef.current;
  if (!element) {
    return;
  }
  let animatingRoot = instance;
  let animatingRootElement = element;
  while (animatingRoot.parent !== null && animatingRoot.parent.scheduled) {
    animatingRoot = animatingRoot.parent;
    const parentElement = animatingRoot.elementRef.current;
    if (parentElement === null) {
      console.error(
        "Did not expect a parentElement to be missing if scheduled."
      );
      return;
    }
    animatingRootElement = parentElement;
  }
  const cancel = animate(
    animatingRootElement,
    element,
    caretElement,
    animatingRoot.duration,
    instance.fps,
    instance.delay
  );
  if (cancel) {
    instance.runningAnimation = cancel;
  }
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

    if (instance.scheduled) {
      console.error("Did not expect to see the instance already scheduled.");
      return;
    }

    let canceled = false;
    if (wasSSR.current) {
      // If we're hydrating, it's too late to run the animation.
      // We have already painted the content.
    } else {
      // Schedule an animation to after we know if any parents/siblings will animate too.
      instance.scheduled = true;
      queueMicrotask(() => {
        if (canceled) {
          return;
        }
        instance.scheduled = false;
        attemptAnimation(instance);
      });
    }
    return () => {
      canceled = true;
      instance.scheduled = false;
      // Remove ourselves from the parent.
      if (parentInstance !== null) {
        instance.parent = null;
        const parentChildren = parentInstance.children;
        const idx = parentChildren.indexOf(instance);
        if (idx !== -1) {
          parentChildren.splice(idx, 1);
        }
      }
      const cancel = instance.runningAnimation;
      if (cancel) {
        instance.runningAnimation = null;
        cancel();
      }
    };
  }, [parentInstance, instance]);

  return (
    <TypeWriterContext.Provider value={instance}>
      <span
        ref={instance.elementRef}
        style={{
          // The reason we need an inline-block element or block element as the root
          // is because clip-path's reference frame is not standardized for inline
          // elements and browsers differ in how they implement it.
          display: "inline-block",
        }}
      >
        {children}
      </span>
      {caret != null ? (
        <span
          ref={instance.caretRef}
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
        >
          {caret}
        </span>
      ) : null}
    </TypeWriterContext.Provider>
  );
}

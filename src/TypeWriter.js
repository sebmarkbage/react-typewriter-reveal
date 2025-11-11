"use client";

import { useRef, useLayoutEffect } from "react";

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

function countSteps(node) {
  // Count how many potential steps we can break this node down into.
  switch (node.nodeType) {
    case TEXT_NODE:
      return node.nodeValue.length;
    case ELEMENT_NODE:
      if (isInvisible(node)) {
        // This whole element is invisible. Don't consider it part of the content.
        return 0;
      }
      if (isContentElement(node)) {
        return getContentLength(node);
      }
      let sum = 0;
      let child = node.firstChild;
      while (child !== null) {
        sum += countSteps(child);
        child = child.nextSibling;
      }
      return sum;
    default:
      return 0;
  }
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

function animate(element, duration, fps) {
  const frameCount = Math.floor((duration * fps) / 1000);
  if (frameCount < 2) {
    console.warn("TypeWriter duration or fps is too small.");
    return;
  }
  const keyframes = [];
  const range = document.createRange();
  range.setStart(element, 0);
  range.setEnd(element, 0);
  const stepsPerFrame = countSteps(element) / frameCount;
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
  let path = "";
  for (let i = 0; i < frameCount - 1; i++) {
    // We compute the steps move based on where we are and where we should
    // be so that we spread out the number of steps through the sequence.
    const stepWeShouldBeAt = stepsPerFrame * (i + 1);
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
    }
    keyframes.push({
      clipPath: path === "" ? "polygon(0 0)" : 'path("' + path + '")',
    });
    currentStep += stepsToMove + overshoot;
  }
  // The last frame shows everything.
  keyframes.push({
    clipPath: "none",
  });
  element.animate(keyframes, {
    duration: duration,
  });
}

export default function TypeWriter({ children, fps = 60, duration = 300 }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    animate(element, duration, fps);
  }, []);
  return (
    <span ref={ref} style={{ display: "inline-block" }}>
      {children}
    </span>
  );
}

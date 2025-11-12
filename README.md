# react-typewriter-reveal

Animates its content by clipping the content by text characters and only revealing piece by piece.

```js
import TypeWriter from 'react-typewriter-reveal';
...
return (
  <TypeWriter>
    <p>paragraph 1</p>
    <p>paragraph 12</p>
  </TypeWriter>
);
```

The `duration` (milliseconds) prop can be used to control how long an animation runs for. The default is 300ms.

The `fps` prop can be used to control how many frames per second are animated. The default is 60fps. Lowering can give a different effect.

```js
import TypeWriter from 'react-typewriter-reveal';
...
return (
  <TypeWriter duration={1000} fps={15}>
    ...
  </TypeWriter>
);
```

To render a caret at the end of the last text to be revealed, you can provide an element to render to the `caret` prop.

```js
import TypeWriter from 'react-typewriter-reveal';
...
return (
  <TypeWriter caret={<span className="border-l border-black border-solid" />}>
    ...
  </TypeWriter>
);
```

Block elements with their own background, border or outline will be revealed as a single unit. You can use nested `<TypeWriter>` to reveal the text inside a block incrementally.

```js
import TypeWriter from 'react-typewriter-reveal';
...
return (
  <TypeWriter duration={1000} fps={15}>
    <p>First paragraph.</p>
    <code className="block bg-gray-100">
      <TypeWriter caret="_">
        console.log('Hello, world!');
      </TypeWriter>
    </code>
    <p>...</p>
  </TypeWriter>
);
```

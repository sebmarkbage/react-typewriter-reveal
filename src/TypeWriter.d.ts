interface TypeWriterProps {
  children: React.ReactNode,
  /**
   * The number of milliseconds to delay.
   * @default 0
   */
  delay?: number,
  /**
   * The number of milliseconds the animation should run for.
   * @default 300
   */
  duration?: number,
  /**
 * The number of frames per seconds each step is rendered at.
 * @default 60
 */
  fps?: number,
  /**
   * A React component to render at the end of the currently visible text.
   */
  caret?: React.ReactNode,
}

/**
 * Animates its content by clipping the content by text characters and only revealing piece by piece.
 */
export default function TypeWriter(props: TypeWriterProps): React.ReactNode;

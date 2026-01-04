import MarkdownIt from "markdown-it";
// @ts-expect-error: No type declarations available
import taskLists from "markdown-it-task-lists";
import { createMemo } from "solid-js";

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
}).use(taskLists, { enabled: true, label: true, labelAfter: true });

interface MarkdownContentProps {
  content: string;
  class?: string;
}

export const MarkdownContent = (props: MarkdownContentProps) => {
  const renderedHtml = createMemo(() => md.render(props.content));

  return (
    <div
      class={`prose prose-slate max-w-none ${props.class ?? ""}`}
      innerHTML={renderedHtml()}
    />
  );
};

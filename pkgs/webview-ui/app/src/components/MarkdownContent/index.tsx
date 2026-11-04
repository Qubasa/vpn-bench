import MarkdownIt from "markdown-it";
// @ts-expect-error: No type declarations available
import taskLists from "markdown-it-task-lists";
import { createMemo } from "solid-js";

interface RenderEnv {
  links?: Readonly<Record<string, string>>;
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
}).use(taskLists, { enabled: true, label: true, labelAfter: true });

const renderCode = md.renderer.rules.code_inline;

md.renderer.rules.code_inline = (
  tokens,
  idx,
  options,
  env: RenderEnv,
  self,
) => {
  const html = renderCode
    ? renderCode(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
  const url = env.links?.[tokens[idx].content];
  if (url === undefined) {
    return html;
  }
  const href = md.utils.escapeHtml(url);
  const style = "text-sky-700 underline decoration-dotted underline-offset-2";
  return `<a class="${style}" href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`;
};

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  if (/^https?:/.test(tokens[idx].attrGet("href") ?? "")) {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
  }
  return self.renderToken(tokens, idx, options);
};

interface MarkdownContentProps {
  content: string;
  class?: string;
  /** Inline code spans to turn into links, by their exact text. */
  links?: Readonly<Record<string, string>>;
}

export const MarkdownContent = (props: MarkdownContentProps) => {
  const renderedHtml = createMemo(() => {
    const env: RenderEnv = { links: props.links };
    return md.render(props.content, env);
  });

  return (
    <div
      class={`prose prose-slate max-w-5xl ${props.class ?? ""}`}
      innerHTML={renderedHtml()}
    />
  );
};

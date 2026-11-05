import sanitizeHtml from "sanitize-html";

/** Instructor content becomes learner/admin-facing HTML: regex replacement is not a security boundary. */
export function sanitiseInstructorLessonHtml(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const cleaned = sanitizeHtml(value, {
    allowedTags: Array.from(new Set([...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2", "sup", "sub"])),
    allowedAttributes: {
      "*": ["class", "style"],
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan"], th: ["colspan", "rowspan", "scope"],
      ol: ["start"], li: ["value"],
    },
    allowedSchemes: ["https", "http", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        color: [/^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i],
        "background-color": [/^(#[\da-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\))$/i],
        "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "font-style": [/^(?:normal|italic)$/],
        "text-align": [/^(?:left|right|center|justify)$/],
        "text-decoration": [/^(?:none|underline|line-through)$/],
        "white-space": [/^(?:normal|pre|pre-wrap|pre-line)$/],
      },
    },
    transformTags: {
      a: (_tag, attribs) => ({ tagName: "a", attribs: { ...attribs, rel: "noopener noreferrer" } }),
    },
  }).trim();
  return cleaned || null;
}

/** Attribute-aware parsing cannot mistake `src=` within alt/title text for an image's actual source. */
export function instructorHtmlImageSources(value: string | null | undefined): string[] {
  const sources: string[] = [];
  sanitizeHtml(value ?? "", {
    allowedTags: ["img"],
    allowedAttributes: { img: ["src"] },
    transformTags: {
      img: (_tag, attribs) => {
        if (attribs.src) sources.push(attribs.src);
        return { tagName: "img", attribs };
      },
    },
  });
  return sources;
}

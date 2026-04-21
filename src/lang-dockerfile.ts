import { LanguageSupport, StreamLanguage, StringStream } from "@codemirror/language";

const INSTRUCTIONS = new Set([
  "from", "run", "cmd", "label", "maintainer", "expose", "env", "add",
  "copy", "entrypoint", "volume", "user", "workdir", "arg", "onbuild",
  "stopsignal", "healthcheck", "shell",
]);

interface DockerState {
  inInstruction: boolean;
  inString: false | "\"" | "'";
  afterContinuation: boolean;
}

function tokenize(stream: StringStream, state: DockerState): string | null {
  // Handle continuation from previous line
  if (stream.sol()) {
    if (!state.afterContinuation) {
      state.inInstruction = false;
    }
    state.afterContinuation = false;
  }

  // Comments (only at start-of-line when not in an instruction continuation)
  if (stream.sol() && !state.inInstruction && stream.match(/^#.*/)) {
    return "comment";
  }

  // String handling
  if (state.inString) {
    const quote = state.inString;
    while (!stream.eol()) {
      const ch = stream.next()!;
      if (ch === "\\") {
        stream.next(); // skip escaped char
      } else if (ch === quote) {
        state.inString = false;
        return "string";
      }
    }
    return "string";
  }

  // Start of string
  if (stream.peek() === '"' || stream.peek() === "'") {
    const quote = stream.next()! as "\"" | "'";
    state.inString = quote;
    while (!stream.eol()) {
      const ch = stream.next()!;
      if (ch === "\\") {
        stream.next();
      } else if (ch === quote) {
        state.inString = false;
        return "string";
      }
    }
    return "string";
  }

  // Instruction keyword at start of line
  if (stream.sol() && !state.inInstruction) {
    if (stream.match(/^\s*\w+/) !== null) {
      const word = stream.current().trim().toLowerCase();
      if (INSTRUCTIONS.has(word)) {
        state.inInstruction = true;
        return "keyword";
      }
    }
    // Not an instruction — consume remainder
    stream.skipToEnd();
    return null;
  }

  // Variable reference: $VAR or ${VAR}
  if (stream.match(/^\$\{[^}]+\}/)) {
    return "variableName.special";
  }
  if (stream.match(/^\$[A-Za-z_]\w*/)) {
    return "variableName.special";
  }

  // Flags: --flag or -f
  if (stream.match(/^--?[\w][\w-]*/)) {
    return "attributeName";
  }

  // AS keyword (in FROM ... AS ...)
  if (stream.match(/^(?:AS)\b/i)) {
    return "keyword";
  }

  // Numbers
  if (stream.match(/^\d+/)) {
    return "number";
  }

  // Line continuation
  if (stream.match(/^\\$/)) {
    state.afterContinuation = true;
    state.inInstruction = true;
    return "operator";
  }

  // Consume one char
  stream.next();
  return null;
}

const dockerfileMode = StreamLanguage.define<DockerState>({
  startState(): DockerState {
    return { inInstruction: false, inString: false, afterContinuation: false };
  },
  token: tokenize,
  languageData: {
    commentTokens: { line: "#" },
  },
});

export function dockerfile(): LanguageSupport {
  return new LanguageSupport(dockerfileMode);
}

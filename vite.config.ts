import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite-plus"

const baseIgnorePatters = [
  "**/node_modules/**",
  "**/.convex/_generated/**",
  "**/.convex/betterAuth/_generated/**",
  "**/routeTree.gen.ts",
  "**/bun.lock"
]

const config = defineConfig({
  staged: {
    "*": "vp check --fix"
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [...baseIgnorePatters],
    plugins: [
      "react",
      "typescript",
      "unicorn",
      "import",
      "node",
      "promise",
      "react-perf",
      "jsx-a11y"
    ],
    env: {
      builtin: true
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": "warn",
      "@typescript-eslint/no-confusing-void-expression": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/only-throw-error": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "require-yield": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  },
  fmt: {
    singleQuote: false,
    semi: false,
    trailingComma: "none",
    ignorePatterns: [...baseIgnorePatters],
    sortImports: {
      groups: [
        "builtin",
        "external",
        ["internal", "subpath"],
        ["parent", "sibling", "index"],
        "style",
        "unknown"
      ],
      newlinesBetween: true,
      order: "asc",
      internalPattern: ["^~/", "^@/"]
    },
    sortTailwindcss: {
      functions: ["clsx", "cn", "cva", "tw"]
    },
    sortPackageJson: {
      sortScripts: false
    }
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//, "async_hooks", "node:async_hooks"] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    babel({ presets: [reactCompilerPreset()] }),
    {
      name: "async-hooks-client-stub",
      resolveId(id: string, _importer: string | undefined, options: { ssr?: boolean }) {
        if (!options?.ssr && (id === "async_hooks" || id === "node:async_hooks")) {
          return "\0async-hooks-stub"
        }
      },
      load(id: string) {
        if (id === "\0async-hooks-stub") {
          return `
export class AsyncLocalStorage {
  run(store, fn, ...args) { return fn(...args) }
  getStore() { return undefined }
  enterWith() {}
  disable() {}
}
export class AsyncResource {
  static bind(fn) { return fn }
  bind(fn) { return fn }
  runInAsyncScope(fn, ...args) { return fn(...args) }
}
`
        }
      }
    }
  ]
})

export default config

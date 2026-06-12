/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_PUBLIC_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

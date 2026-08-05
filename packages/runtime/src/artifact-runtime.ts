export const ARTIFACT_RUNTIME_ORIGIN_PLACEHOLDER =
  "https://nimbase-artifact-runtime.invalid";

export const ARTIFACT_RUNTIME_ASSETS = {
  react: {
    source: "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
    integrity:
      "sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z",
  },
  "react-dom": {
    source:
      "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
    integrity:
      "sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1",
  },
  "prop-types": {
    source: "https://unpkg.com/prop-types@15.8.1/prop-types.min.js",
    integrity:
      "sha384-/AfDwVDXNopzPvhxMPQ11y1OCpR6mVkWx47qzSwIiquvxkcMkZddEzDNtIOtfCpk",
  },
  recharts: {
    source: "https://unpkg.com/recharts@2.15.4/umd/Recharts.js",
    integrity:
      "sha384-8WLbYxXTeAFm5KD1lWOhUghb4T1QP+Y15d4aEGIFc6zzN2BMObhTK1u7mXiLbp8p",
  },
  lucide: {
    source: "https://unpkg.com/lucide-react@0.469.0/dist/umd/lucide-react.js",
    integrity:
      "sha384-oNoFxpoHrsDhPry7tF2+EBqphbaCFnfDOfEcsNwIMBlnbEEaaRpGLqsK5daiGVFe",
  },
  clsx: {
    source: "https://unpkg.com/clsx@2.1.1/dist/clsx.min.js",
    integrity:
      "sha384-dEq4EUqxSIwObxCTXRGn1G8uU8Dqce+ragCb5MYDS6s+QHC2gaYQLxHklTJLaked",
  },
  tailwind: {
    source: "https://cdn.tailwindcss.com/3.4.17",
    integrity:
      "sha384-igm5BeiBt36UU4gqwWS7imYmelpTsZlQ45FZf+XBn9MuJbn4nQr7yx1yFydocC/K",
  },
  mermaid: {
    source: "https://unpkg.com/mermaid@11.12.0/dist/mermaid.min.js",
    integrity:
      "sha384-o+g/BxPwhi0C3RK7oQBxQuNimeafQ3GE/ST4iT2BxVI4Wzt60SH4pq9iXVYujjaS",
  },
} as const;

export type ArtifactRuntimeAssetName = keyof typeof ARTIFACT_RUNTIME_ASSETS;

export function artifactRuntimeUrl(name: ArtifactRuntimeAssetName): string {
  return `${ARTIFACT_RUNTIME_ORIGIN_PLACEHOLDER}/api/artifact-runtime/${name}`;
}

export function isArtifactRuntimeAssetName(
  value: string,
): value is ArtifactRuntimeAssetName {
  return Object.hasOwn(ARTIFACT_RUNTIME_ASSETS, value);
}

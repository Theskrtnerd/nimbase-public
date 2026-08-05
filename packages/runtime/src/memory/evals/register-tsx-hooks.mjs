// Preload shim: registers the module-resolution hooks (server-only → empty) for
// the eval's tsx scripts. Used as `tsx --import ./register-tsx-hooks.mjs …`.
import { register } from "node:module";

register("./tsx-hooks.mjs", import.meta.url);

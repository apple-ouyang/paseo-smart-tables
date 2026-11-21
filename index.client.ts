import type { PluginClientContext } from "@getpaseo/plugin/client";
import { installSmartTables } from "./client/dom.ts";

export default function contribute(_client: PluginClientContext) {
  if (typeof document === "undefined") {
    return () => {};
  }
  return installSmartTables(document);
}

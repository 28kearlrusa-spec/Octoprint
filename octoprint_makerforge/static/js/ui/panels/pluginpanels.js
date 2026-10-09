// Plugins on the Print page: the panels and tabs of every plugin placed on Print (by default
// every plugin's sidebar panel), running in OctoPrint's classic page so each one works exactly
// as it does there.
import { mountPluginDock } from "mf/ui/panels/plugindock.js";

export function mountPluginPanels(host) {
  return mountPluginDock(host, "print", {
    title: "Plugins",
    empty: "No installed plugin is placed on the Print page. Plugin pages are under Plugins in the menu.",
  });
}

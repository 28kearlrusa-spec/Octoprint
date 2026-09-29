/* MakerForge helpers for OctoPrint's classic UI.
 *
 * This file is bundled into OctoPrint's own page (not the MakerForge app). It only toggles the
 * `mf-skin` class from the plugin setting, so the skin in classic.css can be switched off.
 */
$(function () {
    function MakerForgeClassicViewModel(parameters) {
        var self = this;
        self.settings = parameters[0];

        self.apply = function () {
            try {
                var s = self.settings.settings.plugins.makerforge;
                document.documentElement.classList.toggle("mf-skin", !!s.classic_skin());
            } catch (e) {
                // settings not ready or plugin settings missing: leave the stock look alone
            }
        };
        self.onAllBound = self.apply;
        self.onSettingsHidden = self.apply;
        self.onServerReconnect = self.apply;
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: MakerForgeClassicViewModel,
        dependencies: ["settingsViewModel"],
        elements: []
    });
});

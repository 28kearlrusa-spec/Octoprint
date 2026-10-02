/* MakerPrint helpers for OctoPrint's classic UI.
 *
 * This file is bundled into OctoPrint's own page (not the MakerPrint app). It only toggles the
 * `mf-skin` class from the plugin setting, so the skin in classic.css can be switched off.
 */
// Inside MakerPrint's frames, OctoPrint focusing a field must not scroll MakerPrint's page
if (/[?&]mfembed=1/.test(location.search)) {
    (function () {
        var focus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (opts) {
            return focus.call(this, $.extend({}, opts, { preventScroll: true }));
        };
    })();
}

$(function () {
    function MakerPrintClassicViewModel(parameters) {
        var self = this;
        self.settings = parameters[0];

        // Inside MakerPrint's Plugins screen with the light Studio look, OctoPrint's own light
        // page matches better than the dark skin.
        var inStudio = function () {
            try {
                return /[?&]mfembed=1/.test(location.search) &&
                    (JSON.parse(localStorage.getItem("mf.prefs.v1") || "{}") || {}).look === "studio";
            } catch (e) {
                return false;
            }
        };

        self.apply = function () {
            try {
                var s = self.settings.settings.plugins.makerforge;
                document.documentElement.classList.toggle("mf-skin", !!s.classic_skin() && !inStudio());
            } catch (e) {
                // settings not ready or plugin settings missing: leave the stock look alone
            }
        };
        self.onAllBound = self.apply;
        self.onSettingsHidden = self.apply;
        self.onServerReconnect = self.apply;
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: MakerPrintClassicViewModel,
        dependencies: ["settingsViewModel"],
        elements: []
    });
});

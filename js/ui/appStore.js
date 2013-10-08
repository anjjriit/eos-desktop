// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;

const APP_STORE_NAME = 'com.endlessm.AppStore';
const APP_STORE_PATH = '/com/endlessm/AppStore';
const APP_STORE_IFACE = 'com.endlessm.AppStore';

const AppStoreIface = <interface name={APP_STORE_NAME}>
  <method name="Toggle">
    <arg type="b" direction="in" name="reset"/>
    <arg type="u" direction="in" name="timestamp"/>
  </method>
  <method name="ShowPage">
    <arg type="s" direction="in" name="page"/>
    <arg type="u" direction="in" name="timestamp"/>
  </method>
  <property name="Visible" type="b" access="read"/>
</interface>;

const AppStoreProxy = Gio.DBusProxy.makeProxyWrapper(AppStoreIface);

const AppStore = new Lang.Class({
    Name: 'AppStore',

    _init: function() {
        this._overviewHiddenId = 0;

        this.proxy = new AppStoreProxy(Gio.DBus.session,
            APP_STORE_NAME, APP_STORE_PATH, Lang.bind(this, this._onProxyConstructed));

        Main.overview.connect('showing', Lang.bind(this, this._onOverviewShowing));
    },

    _onProxyConstructed: function() {
        // nothing to do
    },

    _onOverviewShowing: function() {
        // Make the AppStore close (slide in) when the overview is shown
        if (this.proxy.Visible) {
            this.toggle(false);
        }
    },

    toggle: function(reset) {
        this._activate(Lang.bind(this, function() { this._doToggle(reset); }));
    },

    showPage: function(page) {
        this._activate(Lang.bind(this, function() { this._doShowPage(page); }));
    },

    _activate: function(activateMethod) {
        // The background menu is shown on the overview screen. However, to
        // show the AppStore, we must first hide the overview. For maximum
        // visual niceness, we also take the extra step to wait until the
        // overview has finished hiding itself before triggering the slide-in
        // animation of the AppStore.
        if (Main.overview.visible) {
            if (!this._overviewHiddenId) {
                this._overviewHiddenId =
                    Main.overview.connect('hidden', activateMethod);
            }
            Main.overview.hide();
        } else {
            activateMethod();
        }
    },

    _doToggle: function(reset) {
        this.proxy.ToggleRemote(reset, global.get_current_time());
    },

    _doShowPage: function(page) {
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }
        this.proxy.ShowPageRemote(page, global.get_current_time());
    }
});

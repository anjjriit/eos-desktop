// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const St = imports.gi.St;
const UPower = imports.gi.UPowerGlib;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';

const PowerManagerInterface = '<node> \
<interface name="org.gnome.SettingsDaemon.Power"> \
<method name="GetDevices"> \
    <arg type="a(susdut)" direction="out" /> \
</method> \
<method name="GetPrimaryDevice"> \
    <arg type="(susdut)" direction="out" /> \
</method> \
<property name="Icon" type="s" access="read" /> \
</interface> \
</node>';

const PowerManagerProxy = Gio.DBusProxy.makeProxyWrapper(PowerManagerInterface);

const Indicator = new Lang.Class({
    Name: 'PowerIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('battery-missing-symbolic', _("Battery"));

        this._proxy = new PowerManagerProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH,
                                            Lang.bind(this, function(proxy, error) {
                                                if (error) {
                                                    log(error.message);
                                                    return;
                                                }
                                                this._proxy.connect('g-properties-changed',
                                                                    Lang.bind(this, this._sync));
                                                this._sync();
                                            }));

        this._item = new PopupMenu.PopupMenuItem('', { reactive: false });
        this.menu.addMenuItem(this._item);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addSettingsAction(_("Power Settings"), 'gnome-power-panel.desktop');
    },

    _statusForDevice: function(device) {
        let [device_id, device_type, icon, percentage, state, seconds] = device;

        if (state == UPower.DeviceState.FULLY_CHARGED)
            return _("Fully Charged");

        let time = Math.round(seconds / 60);
        if (time == 0) {
            // 0 is reported when UPower does not have enough data
            // to estimate battery life
            return _("Estimating…");
        }

        let minutes = time % 60;
        let hours = Math.floor(time / 60);

        if (state == UPower.DeviceState.DISCHARGING) {
            // Translators: this is <hours>:<minutes> Remaining (<percentage>)
            return _("%d\u2236%02d Remaining (%d%%)").format(hours, minutes, percentage);
        }

        if (state == UPower.DeviceState.CHARGING) {
            // Translators: this is <hours>:<minutes> Until Full (<percentage>)
            return _("%d\u2236%02d Until Full (%d%%)").format(hours, minutes, percentage);
        }

        // state is one of PENDING_CHARGING, PENDING_DISCHARGING
        return _("Estimating…");
    },

    _syncStatusLabel: function() {
        this._proxy.GetPrimaryDeviceRemote(Lang.bind(this, function(result, error) {
            if (error) {
                this._item.actor.hide();
                return;
            }

            let [device] = result;
            let [device_id, device_type] = device;
            if (device_type == UPower.DeviceKind.BATTERY) {
                this._item.label.text = this._statusForDevice(device);
                this._item.actor.show();
            } else {
                this._item.actor.hide();
            }
        }));
    },

    _syncIcon: function() {
        let icon = this._proxy.Icon;
        let hasIcon = false;

        if (icon) {
            let gicon = Gio.icon_new_for_string(icon);
            this.setGIcon(gicon);
            this._item.icon.gicon = gicon;
            hasIcon = true;
        }
        this.mainIcon.visible = hasIcon;
        this.actor.visible = hasIcon;
    },

    _sync: function() {
        this._syncIcon();
        this._syncStatusLabel();
    }
});

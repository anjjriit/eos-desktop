// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const BoxPointer = imports.ui.boxpointer;
const ButtonConstants = imports.ui.buttonConstants;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const BackgroundMenu = new Lang.Class({
    Name: 'BackgroundMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(source, layoutManager) {
        this.parent(source, 0, St.Side.TOP);

        this.addSettingsAction(_("Change Background…"), 'gnome-background-panel.desktop');

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.addAction(_("Add App"), Lang.bind(this, function() {
            Main.appStore.showPage(global.get_current_time(), 'apps');
        }));

        this.addAction(_("Add Website"), Lang.bind(this, function() {
            Main.appStore.showPage(global.get_current_time(), 'web');
        }));

        this.addAction(_("Add Folder"), Lang.bind(this, function() {
            Main.appStore.showPage(global.get_current_time(), 'folders');
        }));

        this.actor.add_style_class_name('background-menu');

        layoutManager.uiGroup.add_actor(this.actor);
        this.actor.hide();
    }
});

function addBackgroundMenu(clickAction, layoutManager) {
    if (!Main.sessionMode.hasOverview) {
        return;
    }

    let cursor = new St.Bin({ opacity: 0 });
    layoutManager.uiGroup.add_actor(cursor);

    let actor = clickAction.get_actor();

    actor.reactive = true;
    actor._backgroundMenu = new BackgroundMenu(cursor, layoutManager);
    actor._backgroundManager = new PopupMenu.PopupMenuManager({ actor: actor });
    actor._backgroundManager.addMenu(actor._backgroundMenu);

    actor.connect('destroy', function() {
                      actor._backgroundMenu.destroy();
                      actor._backgroundMenu = null;
                      actor._backgroundManager = null;

                      cursor.destroy();
                  });

    function openMenu() {
        let [x, y] = global.get_pointer();
        cursor.set_position(x, y);
        actor._backgroundMenu.open(BoxPointer.PopupAnimation.NONE);
    }

    clickAction.connect('long-press', function(action, actor, state) {
        if (state == Clutter.LongPressState.QUERY)
            return action.get_button() == 1 && !actor._backgroundMenu.isOpen;
        if (state == Clutter.LongPressState.ACTIVATE)
            openMenu();
        return true;
    });
    clickAction.connect('clicked', function(action) {
        let button = action.get_button();
        if (button == ButtonConstants.RIGHT_MOUSE_BUTTON) {
            openMenu();
        }
    });
}

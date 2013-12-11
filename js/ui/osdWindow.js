// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;

const Lang = imports.lang;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;

const HIDE_TIMEOUT = 1500;
const FADE_TIME = 0.1;
const LEVEL_ANIMATION_TIME = 0.1;

const LevelBar = new Lang.Class({
    Name: 'LevelBar',

    _init: function() {
        this._level = 0;

        this.actor = new St.Bin({ style_class: 'level',
                                  x_fill: true, y_fill: true });
        this._bar = new St.DrawingArea();
        this._bar.connect('repaint', Lang.bind(this, this._repaint));

        this.actor.set_child(this._bar);
    },

    get level() {
        return this._level;
    },

    set level(value) {
        let newValue = Math.max(0, Math.min(value, 100));
        if (newValue == this._level)
            return;
        this._level = newValue;
        this._bar.queue_repaint();
    },

    _repaint: function() {
        let cr = this._bar.get_context();

        let node = this.actor.get_theme_node();
        let radius = node.get_border_radius(0); // assume same radius for all corners
        Clutter.cairo_set_source_color(cr, node.get_foreground_color());

        let [w, h] = this._bar.get_surface_size();
        w *= (this._level / 100.);

        if (w == 0)
            return;

        cr.moveTo(radius, 0);
        if (w >= radius)
            cr.arc(w - radius, radius, radius, 1.5 * Math.PI, 2. * Math.PI);
        else
            cr.lineTo(w, 0);
        if (w >= radius)
            cr.arc(w - radius, h - radius, radius, 0, 0.5 * Math.PI);
        else
            cr.lineTo(w, h);
        cr.arc(radius, h - radius, radius, 0.5 * Math.PI, Math.PI);
        cr.arc(radius, radius, radius, Math.PI, 1.5 * Math.PI);
        cr.fill();
    }
});

const OsdWindow = new Lang.Class({
    Name: 'OsdWindow',

    _init: function() {
        this.actor = new St.Widget({ x_expand: true,
                                     y_expand: true,
                                     x_align: Clutter.ActorAlign.CENTER,
                                     y_align: Clutter.ActorAlign.CENTER });
        this.actor.add_constraint(new Layout.MonitorConstraint({ primary: true }));
        this._box = new St.BoxLayout({ style_class: 'osd-window',
                                       vertical: true });
        this.actor.add_actor(this._box);

        this._icon = new St.Icon();
        this._box.add(this._icon, { expand: true });

        this._label = new St.Label();
        this._box.add(this._label);

        this._level = new LevelBar();
        this._box.add(this._level.actor);

        this._hideTimeoutId = 0;
        this._reset();

        Main.layoutManager.connect('monitors-changed',
                                   Lang.bind(this, this._monitorsChanged));
        this._monitorsChanged();

        Main.uiGroup.add_child(this.actor);
    },

    setIcon: function(icon) {
        this._icon.gicon = icon;
    },

    setLabel: function(label) {
        this._label.visible = (label != undefined);
        if (label)
            this._label.text = label;
    },

    setLevel: function(level) {
        this._level.actor.visible = (level != undefined);
        if (this.actor.visible)
            Tweener.addTween(this._level,
                             { level: level,
                               time: LEVEL_ANIMATION_TIME,
                               transition: 'easeOutQuad' });
        else
            this._level.level = level;
    },

    show: function() {
        if (!this._icon.gicon)
            return;

        if (!this.actor.visible) {
            Meta.disable_unredirect_for_screen(global.screen);
            this.actor.show();
            this.actor.opacity = 0;

            Tweener.addTween(this.actor,
                             { opacity: 255,
                               time: FADE_TIME,
                               transition: 'easeOutQuad' });
        }

        if (this._hideTimeoutId)
            Mainloop.source_remove(this._hideTimeoutId);
        this._hideTimeoutId = Mainloop.timeout_add(HIDE_TIMEOUT,
                                                   Lang.bind(this, this._hide));
    },

    cancel: function() {
        if (!this._hideTimeoutId)
            return;

        Mainloop.source_remove(this._hideTimeoutId);
        this._hideTimeoutId = 0;
        this._hide();
    },

    _hide: function() {
        Tweener.addTween(this.actor,
                         { opacity: 0,
                           time: FADE_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, this._reset) });
    },

    _reset: function() {
        this.actor.hide();
        this.setLabel(null);
        this.setLevel(null);
        Meta.enable_unredirect_for_screen(global.screen);
    },

    _monitorsChanged: function() {
        /* assume 110x110 on a 640x480 display and scale from there */
        let monitor = Main.layoutManager.primaryMonitor;
        let scalew = monitor.width / 640.0;
        let scaleh = monitor.height / 480.0;
        let scale = Math.min(scalew, scaleh);
        let size = 110 * Math.max(1, scale);

        this._box.set_size(size, size);
        this._box.translation_y = monitor.height / 4;

        this._icon.icon_size = size / 2;
    }
});

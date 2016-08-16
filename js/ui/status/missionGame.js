// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Showmehow = imports.gi.Showmehow;
const Signals = imports.signals;
const Tweener = imports.ui.tweener;

const BoxPointer = imports.ui.boxpointer;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const InterfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });

function launchLessonAction(lesson) {
    return function(event) {
        /* XXX: This needs to spawn a wrapper script that goes through each lesson
         * individually as opposed to just running showmehow. */
        const argv = ["/usr/bin/gnome-terminal", "-e", "showmehow " + lesson];
        const flags = GLib.SpawnFlags.DO_NOT_REAP_CHILD;
        const [ok, pid] = GLib.spawn_async(null, argv, null, flags, null);

        if (!ok) {
            log("Warning: Failed to call " + argv.join(" "));
        }
    }
}

/**
 * createSubMenuMenuItemWithFauxParent
 *
 * PopupSubMenuMenuItem makes assumptions about its parent
 * container. Thankfully the surface area of that assumption
 * is quite small, so monkey-patch _getTopMenu to just return
 * the parent and hope for the best.
 */
function createSubMenuMenuItemWithFauxParent(name, parent) {
    let item = new PopupMenu.PopupSubMenuMenuItem(name);
    item.menu._getTopMenu = Lang.bind(item, function() {
        return parent;
    });
    return item;
}


/**
 * addSubMenuItemToBox
 *
 * Simulates what happens in addMenuItem.
 */
function addSubMenuItemToBox(subMenuItem, packingBox, menu) {
    packingBox.add(subMenuItem.actor);
    packingBox.add(subMenuItem.menu.actor);

    menu._connectSubMenuSignals(subMenuItem, subMenuItem.menu);
    menu._connectItemSignals(subMenuItem);
    subMenuItem._closingId = menu.connect('open-state-changed', function(self, open) {
        if (!open)
            subMenuItem.menu.close(BoxPointer.PopupAnimation.FADE);
    });
}

/**
 * wrapTextWith
 *
 * Naturally wrap lines at constant, appending prefix to each line,
 * returning an array with the wrapped lines.
 *
 * We need to do this instead of using the line-wrap property on
 * ClutterText since that messes with the text's allocation
 * and causes the text to be tightly packed, instead of
 * overflowing like we want it to.
 */
function wrapTextWith(text, constant, prefix) {
    let lines = [prefix];
    let lineIndex = 0;
    let lineCounter = prefix.length;
    let textCounter = 0;
    let lastSpace = 0;

    while (textCounter < text.length) {
        textCounter++;

        /* Break a line when we either hit a space,
         * hit a newline, when the line (without spaces)
         * is too long or when we're at the end of the text */
        const breakCondition = (text[textCounter] == ' ' ||
                                text[textCounter] == '\n' ||
                                textCounter == text.length ||
                                textCounter - lastSpace >= constant);
        if (breakCondition) {
            /* Hit a space, see if we can append this
             * word, otherwise start a new line */
            let append = text.slice(lastSpace, textCounter);
            if (lineCounter + append.length > constant) {
                lines.push(prefix);
                lineIndex++;
                lineCounter = prefix.length;

                /* Strip leading and trailing whitespace and newlines
                 * and remove any leading newlines as well. */
                lines[lineIndex] = lines[lineIndex] + append.trim().replace(/\n/g, "");;
            } else {
                /* Just replace newlines, but don't touch whitespace. */
                lines[lineIndex] = lines[lineIndex] + append.replace(/\n/g, "");;
            }

            /* If we encountered a '\n', we also need to
             * break lines, though this will just
             * involve inserting a new line. */
            if (text[textCounter] === '\n') {
                lines.push(prefix);
                lineIndex++;
                lineCounter = prefix.length;
            }

            lineCounter += append.length;
            lastSpace = textCounter;
        }
    }

    return lines;
}

function copyObject(src) {
    let dst = {};
    Lang.copyProperties(src, dst);
    return dst;
}

const ScrollingLabel = new Lang.Class({
    Name: 'ScrollingLabel',
    Extends: St.Label,

    _init: function(params) {
        let parentParams = copyObject(params);
        parentParams.text = '';

        this.parent(parentParams);
        this._text = params.text;
        this._textIndex = 0;
        this._scrollTimer = 0;
        this._waitCount = 0;
        this.complete = false;

        this.style_class = 'chatbox-character-text';

        this.set_x_expand(true);
        this.clutter_text.set_x_expand(true);
    },
    start: function(scrollView) {
        /* Avoid double-start */
        if (this._scrollTimer) {
            return;
        }

        /* Immediately display the first character so that
         * scrolling to the bottom will work */
        this._textIndex++;
        this.set_text(this._text.slice(0, this._textIndex));

        /* Add a timeout to gradually display all this text */
        if (this._textIndex < this._text.length) {
            this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, Lang.bind(this, function() {
                if (this._waitCount > 0) {
                    this._waitCount--;
                    return true;
                }

                this._textIndex++;
                this.set_text(this._text.slice(0, this._textIndex));

                /* Stop on punctuation */
                if ("!?.".indexOf(this._text[this._textIndex - 1]) !== -1) {
                    this._waitCount = 100;
                    return true;
                }

                const incomplete = this._textIndex < this._text.length;
                if (!incomplete) {
                    this.complete = true;
                    this.emit('finished-scrolling');
                }

                /* Running this on a timer every time is not
                 * ideal, but I haven't found a better way
                 * ensure the view is reliably always
                 * scrolled */
                scrollView();

                return incomplete;
            }));
        } else {
            this.complete = true;
        }
    },
    fastForward: function() {
        this._textIndex = this._text.length - 1;
    }
});
Signals.addSignalMethods(ScrollingLabel.prototype);

const UserResponseLabel = new Lang.Class({
    Name: 'UserResponseLabel',
    Extends: St.Label,

    _init: function(params) {
        let parentParams = copyObject(params);
        parentParams.text = '';

        this.parent(parentParams);
        this._text = params.text;
        this.complete = false;

        this.style_class = 'chatbox-user-text';

        this.set_x_expand(true);
        this.clutter_text.set_x_expand(true);
    },
    start: function(scrollView) {
        this.set_text(this._text);
        this["translation-y"] = 5;
        this["opacity"] = 0;

        Tweener.addTween(this,
                         { "translation-y": 0,
                           time: 1.0,
                           opacity: 255,
                           onCompleteScope: this,
                           onComplete: function() {
                               this.emit('finished-scrolling');
                               scrollView();
                               this.complete = true;
                           }
                         });
        scrollView();
    },
    fastForward: function() {
    }
});
Signals.addSignalMethods(UserResponseLabel.prototype);

/**
 * _addLabelToChatboxArea
 *
 * Helper function to add a ScrollableLabel to a chatbox results area.
 */
function _addLabelToChatboxArea(label, chatboxResultsArea) {
    chatboxResultsArea.add(label);

    /* Start scrolling the label */
    label.start(function() {
        chatboxResultsArea.vadjustment.set_value(Number.MAX_VALUE);
    });
}

const WRAP_CONSTANT = 42;


/**
 * callWhenComplete
 *
 * Takes an object with keys mapping to bool values, a callback
 * and a key name. Flips the key name to true and checks if
 * they are all true, and if so, calls the callback.
 *
 * This is used by MissionChatboxTextService to ensure that
 * all asynchronous tasks are completed before calling
 * the completion callback. The callback is called with
 * the key that triggered the callback.
 */
function callWhenComplete(completion, key, callback) {
    completion[key] = true;

    /* This is a shorthand way of implementing Array.all
     * using De Morgan's laws and Array.some */
    const complete = !Object.keys(completion).some(function(key) {
        return !completion[key];
    });

    if (complete && callback) {
        callback(key);
    }
}

const MissionChatboxTextService = new Lang.Class({
    Name: 'MissionChatboxTextService',
    Extends: GLib.GObject,

    _init: function(props) {
        this.parent(props);

        /* Null-initialise service for now, but we'll set it later */
        this._service = null;

        /* These properties make up the lesson's content. _lessonInfo refers
         * to all of the text we need to display about the broader "lesson"
         * and _taskInfo is all the text that we need to display about the
         * currently active task.
         *
         * The state of this service moves through each each task until
         * it reaches the end, at which point it displays a message
         * and sets itself to a "done" state.
         */
        this._introLesson = null;
        this._openedForTheFirstTime = false;
        this._currentTaskText = null;
        this._chatboxLessonCounter = 0;

        const name = "com.endlessm.Showmehow.Service";
        const path = "/com/endlessm/Showmehow/Service";

        /* Connect to the service and refresh the content once we have a connection */
        Showmehow.ServiceProxy.new_for_bus(Gio.BusType.SESSION, 0, name, path, null,
                                           Lang.bind(this, function(source, result) {
            this._service = Showmehow.ServiceProxy.new_for_bus_finish(result);
            this._service.connect("lessons-changed", Lang.bind(this, function(proxy) {
                /* When the underlying lessons change, we need to reset the entire
                 * state of this component and start from the beginning, including
                 * showing any warnings.
                 *
                 * Get the intro lesson again then reset all the state back
                 * to its initial point.
                 */
                this._refreshContent(function() {
                    this._introLesson = lessons[0];
                    this._openedForTheFirstTime = false;
                    this._chatboxLessonCounter = 0;
                });
            }));
            this._refreshContent();
        }));
    },
    commenceIntroLesson: function() {
        /* If possible in the current state, commence the intro lesson.
         *
         * That depends on us having not been opened for the first
         * time and the content being loaded. */
        if (!this._openedForTheFirstTime && this._introLesson) {
            this._openedForTheFirstTime = true;
            this._chatboxLessonCounter = 0;

            /* Get warnings and show them first, then show the first
             * chatbox description */
            this._service.call_get_warnings(null, Lang.bind(this, function(source, result) {
                [success, returnValue] = this._service.call_get_warnings_finish(result);
                if (success) {
                    /* Immediately display all warnings in the chatbox */
                    returnValue.deep_unpack().map(function(w) {
                        return w[0];
                    }).forEach(Lang.bind(this, function(w) {
                        this.emit("chat-message", {
                            kind: "scrolling",
                            mode: "immediate",
                            text: w
                        });
                    }));
                } else {
                    log("Call to get_warnings_finish failed");
                }

                this._showTaskDescriptionForLesson(this._chatboxLessonCounter);
            }));
        }
    },
    evaluate: function(text) {
        /* If we're currently doing a lesson, submit this to the
         * service and see what the response is */
        const numLessons = this._introLesson ? this._introLesson[2] : 0;

        if (this._introLesson &&
            this._currentTaskText &&
            this._chatboxLessonCounter < numLessons) {
            this._service.call_attempt_lesson_remote("intro", this._chatboxLessonCounter, text, null,
                                                     Lang.bind(this, function(source, result) {
                [success, returnValue] = this._service.call_attempt_lesson_remote_finish(result);

                if (success) {
                    const [wait_message, printable_output, attemptResult] = returnValue.deep_unpack();

                    /* Ignore the wait message, just print the success or fail message */
                    const textToPrint = attemptResult ? this._currentTaskText.success : this._currentTaskText.fail;
                    this.emit("chat-message", {
                        kind: "scrolling",
                        mode: "animated",
                        text: textToPrint
                    });

                    /* If we were successful, increment the lesson counter and display
                     * the next lesson, if applicable */
                    if (attemptResult) {
                        this._chatboxLessonCounter++;
                        this._showTaskDescriptionForLesson(this._chatboxLessonCounter);
                    }
                } else {
                    log("Failed to call call_attempt_lesson_remote");
                }
            }));
        }
    },
    _refreshContent: function(completedCallback) {
        if (!this._service) {
            log("Attempted to refresh content without a service!");
        }

        var completion = {
            "adventures": false,
            "spells": false,
            "intro": false
        };

        this._service.call_get_unlocked_lessons("console", null, Lang.bind(this, function(source, result) {
            [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);
            lessons = lessons.deep_unpack();

            if (success) {
                this.emit("discover-new-adventures", lessons.map(function(lesson_spec) {
                    return {
                        name: lesson_spec[0],
                        desc: lesson_spec[1]
                    };
                }));
                callWhenComplete(completion, "adventures", completedCallback);
            } else {
                log("Warning: Call to showmehow get_unlocked_lessons failed");
            }
        }));

        this._service.call_get_known_spells("console", null, Lang.bind(this, function(source, result) {
            [success, lessons] = this._service.call_get_known_spells_finish(result);
            lessons = lessons.deep_unpack();

            if (success) {
                this.emit("discover-new-spells", lessons.map(function(lesson_spec) {
                    return {
                        name: lesson_spec[0],
                        desc: lesson_spec[1]
                    };
                }));
                callWhenComplete(completion, "spells", completedCallback);
            } else {
                log("Warning: Call to showmehow get_known_spells failed");
            }
        }));

        this._service.call_get_unlocked_lessons("shell", null, Lang.bind(this, function(source, result) {
            [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);

            if (success) {
                /* There should be a single lesson here called introduction here. Save
                 * it. */
                lessons = lessons.deep_unpack().filter(function(lesson) {
                    return lesson[0] == "intro";
                });

                if (lessons.length !== 1) {
                    log("Expected a single lesson for shell, cannot show intro lesson!");
                    return;
                }

                this._introLesson = lessons[0];
                callWhenComplete(completion, "intro", completedCallback);
            } else {
                log("Warning: Call to showmehow get_unlocked_lessons failed for intro lesson");
            }
        }));
    },
    _showTaskDescriptionForLesson: function(lessonIndex) {
        if (!this._introLesson) {
            return;
        }

        const numLessons = this._introLesson[2];

        if (lessonIndex >= numLessons) {
            /* We have a currently active intro lesson. Display the
             * "done" message, and then set everything back to null. */
            const doneMessage = this._introLesson[3];
            if (this._introLesson) {
                this.emit("chat-message", {
                    kind: "scrolling",
                    mode: "animated",
                    text: doneMessage
                });
                this._introLesson = null;
                this._currentTaskText = null;
                this._chatboxLessonCounter = 0;
            }

            return;
        }

        this._service.call_get_task_description("intro", lessonIndex, null,
                                                Lang.bind(this, function(source, result) {
            [success, returnValue] = this._service.call_get_task_description_finish(result);

            if (success) {
                const [desc, successText, failText] = returnValue.deep_unpack();
                this._currentTaskText = {
                    desc: desc,
                    success: successText,
                    fail: failText
                };

                this.emit("chat-message", {
                    kind: "scrolling",
                    mode: "animated",
                    text: desc
                });
            } else {
                log("Call to call_get_task_description_finish failed");
            }
        }));
    }
});
Signals.addSignalMethods(MissionChatboxTextService.prototype);

const Indicator = new Lang.Class({
    Name: 'MissionGameIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-drag-accept-symbolic', _("Mission"));
        this.setIcon('folder-drag-accept-symbolic');

        this._service = new MissionChatboxTextService();

        this._adventures = createSubMenuMenuItemWithFauxParent(_("Adventures"), this.menu);
        this._spells = createSubMenuMenuItemWithFauxParent(_("Spells"), this.menu);

        const missionSwitch = new PopupMenu.PopupSwitchMenuItem(_("Mission"), false);
        const switchesBox = new St.BoxLayout({vertical: true});
        const hbox = new St.BoxLayout({name: 'switchesArea'});

        this.menu.addActor(hbox);
        hbox.add(switchesBox);
        switchesBox.add(missionSwitch.actor);
        addSubMenuItemToBox(this._adventures, switchesBox, this.menu);
        addSubMenuItemToBox(this._spells, switchesBox, this.menu);

        const separator = new St.DrawingArea({ style_class: 'calendar-vertical-separator',
                                               pseudo_class: 'highlighted' });
        separator.connect('repaint', Lang.bind(this, function(area) {
            let cr = area.get_context();
            let themeNode = area.get_theme_node();
            let [width, height] = area.get_surface_size();
            let stippleColor = themeNode.get_color('-stipple-color');
            let stippleWidth = themeNode.get_length('-stipple-width');
            let x = Math.floor(width/2) + 0.5;
            cr.moveTo(x, 0);
            cr.lineTo(x, height);
            Clutter.cairo_set_source_color(cr, stippleColor);
            cr.setDash([1, 3], 1); // Hard-code for now
            cr.setLineWidth(stippleWidth);
            cr.stroke();
            cr.$dispose();
        }));
        hbox.add(separator);

        const chatboxBox = new St.BoxLayout({ name: 'chatboxArea', vertical: true });
        hbox.add(chatboxBox);

        chatboxBox["margin-top"] = 10;
        chatboxBox["margin-bottom"] = 10;
        chatboxBox["margin-left"] = 10;
        chatboxBox["margin-right"] = 10;

        this._chatboxLabels = [];
        this._chatboxResultsScrollView = new St.ScrollView({ overlay_scrollbars: true });
        this._chatboxResultsArea = new St.BoxLayout({ name: 'chatboxResultsArea', vertical: true });
        const chatboxEntryArea = new St.BoxLayout({ name: 'chatboxEntryArea' });

        this._chatboxResultsScrollView.add_actor(this._chatboxResultsArea);

        chatboxBox.add(this._chatboxResultsScrollView, { expand: true });
        chatboxBox.add(chatboxEntryArea);

        chatboxEntryArea.add(new St.Label({ text: '> ' }));

        this._chatboxEntry = new St.Entry({ can_focus: true });
        chatboxEntryArea.add(this._chatboxEntry, { expand: true });

        chatboxBox.set_size(400, 450);
        chatboxBox.style_class = 'chatbox-text-container';

        /* Null-initialise service for now, but we'll set it later */
        this._service.connect("discover-new-adventures", Lang.bind(this, function(chat, adventures) {
            this._adventures.menu.removeAll();
            adventures.forEach(Lang.bind(this, function(adventure) {
                this._adventures.menu.addAction(adventure.desc, launchLessonAction(adventure.name));
            }));
        }));
        this._service.connect("discover-new-spells", Lang.bind(this, function(chat, spells) {
            this._spells.menu.removeAll();
            spells.forEach(Lang.bind(this, function(spell) {
                this._spells.menu.addAction(spell.desc, launchLessonAction(spell.name));
            }));
        }));
        this._service.connect("chat-message", Lang.bind(this, function(chat, message) {
            const classes = {
                "scrolling": ScrollingLabel,
                "user": UserResponseLabel
            };

            try {
                const labelCls = classes[message.kind];
            } catch(e) {
                log("Cannot display chat message, no such label type " + message.kind);
            }

            const label = new labelCls({
                text: wrapTextWith(message.text, WRAP_CONSTANT, "").join("\n")
            });

            if (message.mode === "immediate") {
                label.fastForward();
            }

            this._pushLabelToChatboxResultsArea(label);
        }));

        this._chatboxEntry.clutter_text.connect('activate', Lang.bind(this, function(entry, event) {
            const text = entry.get_text()
            if (text === '') {
                return true;
            }

            this._pushLabelToChatboxResultsArea(new UserResponseLabel({
                text: wrapTextWith(text.replace('\n', ' ').trim(),
                                   WRAP_CONSTANT,
                                   "").join("\n")
            }));

            this._service.evaluate(text);
            entry.set_text('');
            return true;
        }));

        this.menu.connect('open-state-changed', Lang.bind(this, function(menu, state) {
            if (state) {
                this._service.commenceIntroLesson();
            }
        }));
    },
    _pushLabelToChatboxResultsArea: function(label) {
        /* Push immediately if we're the first or if the last one
         * has finished scrolling */
        const lastLabel = this._chatboxLabels.length === 0 ? null : this._chatboxLabels[this._chatboxLabels.length - 1];
        const immediate = !lastLabel || lastLabel.complete;

        /* Immediately put the label in this._chatboxLabels, however
         * this does not mean it will be immediately added to the
         * area. */
        this._chatboxLabels.push(label);

        if (immediate) {
            _addLabelToChatboxArea(label, this._chatboxResultsArea);
        } else {
            lastLabel.connect('finished-scrolling', Lang.bind(this, function() {
               _addLabelToChatboxArea(label, this._chatboxResultsArea);
            }));
        }
    }
});

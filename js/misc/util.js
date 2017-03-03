// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Config = imports.misc.config;
const Json = imports.gi.Json;
const Tweener = imports.ui.tweener;

const FALLBACK_BROWSER_ID = 'chromium-browser.desktop';

// http://daringfireball.net/2010/07/improved_regex_for_matching_urls
const _balancedParens = '\\((?:[^\\s()<>]+|(?:\\(?:[^\\s()<>]+\\)))*\\)';
const _leadingJunk = '[\\s`(\\[{\'\\"<\u00AB\u201C\u2018]';
const _notTrailingJunk = '[^\\s`!()\\[\\]{};:\'\\".,<>?\u00AB\u00BB\u201C\u201D\u2018\u2019]';

const _urlRegexp = new RegExp(
    '(^|' + _leadingJunk + ')' +
    '(' +
        '(?:' +
            '[a-z][\\w-]+://' +                   // scheme://
            '|' +
            'www\\d{0,3}[.]' +                    // www.
            '|' +
            '[a-z0-9.\\-]+[.][a-z]{2,4}/' +       // foo.xx/
        ')' +
        '(?:' +                                   // one or more:
            '[^\\s()<>]+' +                       // run of non-space non-()
            '|' +                                 // or
            _balancedParens +                     // balanced parens
        ')+' +
        '(?:' +                                   // end with:
            _balancedParens +                     // balanced parens
            '|' +                                 // or
            _notTrailingJunk +                    // last non-junk char
        ')' +
    ')', 'gi');

// findUrls:
// @str: string to find URLs in
//
// Searches @str for URLs and returns an array of objects with %url
// properties showing the matched URL string, and %pos properties indicating
// the position within @str where the URL was found.
//
// Return value: the list of match objects, as described above
function findUrls(str) {
    let res = [], match;
    while ((match = _urlRegexp.exec(str)))
        res.push({ url: match[2], pos: match.index + match[1].length });
    return res;
}

// http://stackoverflow.com/questions/4691070/validate-url-without-www-or-http
const _searchUrlRegexp = new RegExp(
    '^([a-zA-Z0-9]+(\.[a-zA-Z0-9]+)+.*)\\.+[A-Za-z0-9\.\/%&=\?\-_]+$',
    'gi');

// findSearchUrls:
// @terms: list of searchbar terms to find URLs in
//
// Similar to "findUrls", but for use only with terms from the searchbar.
// The regex for these URLs matches strings such as "google.com" (note the
// lack of preceding scheme).
//
// Return value: the list of URLs found in the string
function findSearchUrls(terms) {
    let res = [], match;
    for (let i in terms) {
        while ((match = _searchUrlRegexp.exec(terms[i]))) {
            res.push(match[0]);
        }
    }
    return res;
}

// spawn:
// @argv: an argv array
//
// Runs @argv in the background, handling any errors that occur
// when trying to start the program.
function spawn(argv, errorNotifier) {
    try {
        trySpawn(argv);
    } catch (err) {
        _handleSpawnError(argv[0], err, errorNotifier);
    }
}

// spawnCommandLine:
// @command_line: a command line
//
// Runs @command_line in the background, handling any errors that
// occur when trying to parse or start the program.
function spawnCommandLine(command_line, errorNotifier) {
    try {
        let [success, argv] = GLib.shell_parse_argv(command_line);
        trySpawn(argv);
    } catch (err) {
        _handleSpawnError(command_line, err, errorNotifier);
    }
}

// trySpawn:
// @argv: an argv array
//
// Runs @argv in the background. If launching @argv fails,
// this will throw an error.
function trySpawn(argv)
{
    var success, pid;
    try {
        [success, pid] = GLib.spawn_async(null, argv, null,
                                          GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                          null);
    } catch (err) {
        /* Rewrite the error in case of ENOENT */
        if (err.matches(GLib.SpawnError, GLib.SpawnError.NOENT)) {
            throw new GLib.SpawnError({ code: GLib.SpawnError.NOENT,
                                        message: _("Command not found") });
        } else if (err instanceof GLib.Error) {
            // The exception from gjs contains an error string like:
            //   Error invoking GLib.spawn_command_line_async: Failed to
            //   execute child process "foo" (No such file or directory)
            // We are only interested in the part in the parentheses. (And
            // we can't pattern match the text, since it gets localized.)
            let message = err.message.replace(/.*\((.+)\)/, '$1');
            throw new (err.constructor)({ code: err.code,
                                          message: message });
        } else {
            throw err;
        }
    }
    // Dummy child watch; we don't want to double-fork internally
    // because then we lose the parent-child relationship, which
    // can break polkit.  See https://bugzilla.redhat.com//show_bug.cgi?id=819275
    GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, function () {}, null);
}

// trySpawnCommandLine:
// @command_line: a command line
//
// Runs @command_line in the background. If launching @command_line
// fails, this will throw an error.
function trySpawnCommandLine(command_line) {
    let success, argv;

    try {
        [success, argv] = GLib.shell_parse_argv(command_line);
    } catch (err) {
        // Replace "Error invoking GLib.shell_parse_argv: " with
        // something nicer
        err.message = err.message.replace(/[^:]*: /, _("Could not parse command:") + "\n");
        throw err;
    }

    trySpawn(argv);
}

function _handleSpawnError(command, err, errorNotifier) {
    let title = _("Execution of '%s' failed:").format(command);
    errorNotifier(title, err.message);
}

// killall:
// @processName: a process name
//
// Kills @processName. If no process with the given name is found,
// this will fail silently.
function killall(processName) {
    try {
        // pkill is more portable than killall, but on Linux at least
        // it won't match if you pass more than 15 characters of the
        // process name... However, if you use the '-f' flag to match
        // the entire command line, it will work, but we have to be
        // careful in that case that we can match
        // '/usr/bin/processName' but not 'gedit processName.c' or
        // whatever...

        let argv = ['pkill', '-f', '^([^ ]*/)?' + processName + '($| )'];
        GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
        // It might be useful to return success/failure, but we'd need
        // a wrapper around WIFEXITED and WEXITSTATUS. Since none of
        // the current callers care, we don't bother.
    } catch (e) {
        logError(e, 'Failed to kill ' + processName);
    }
}

// lowerBound:
// @array: an array or array-like object, already sorted
//         according to @cmp
// @val: the value to add
// @cmp: a comparator (or undefined to compare as numbers)
//
// Returns the position of the first element that is not
// lower than @val, according to @cmp.
// That is, returns the first position at which it
// is possible to insert @val without violating the
// order.
// This is quite like an ordinary binary search, except
// that it doesn't stop at first element comparing equal.

function lowerBound(array, val, cmp) {
    let min, max, mid, v;
    cmp = cmp || function(a, b) { return a - b; };

    if (array.length == 0)
        return 0;

    min = 0; max = array.length;
    while (min < (max - 1)) {
        mid = Math.floor((min + max) / 2);
        v = cmp(array[mid], val);

        if (v < 0)
            min = mid + 1;
        else
            max = mid;
    }

    return (min == max || cmp(array[min], val) < 0) ? max : min;
}

// insertSorted:
// @array: an array sorted according to @cmp
// @val: a value to insert
// @cmp: the sorting function
//
// Inserts @val into @array, preserving the
// sorting invariants.
// Returns the position at which it was inserted
function insertSorted(array, val, cmp) {
    let pos = lowerBound(array, val, cmp);
    array.splice(pos, 0, val);

    return pos;
}

function getBrowserApp() {
    let id = FALLBACK_BROWSER_ID;
    let app = Gio.app_info_get_default_for_type('x-scheme-handler/http', true);
    if (app != null)
        id = app.get_id();
    let appSystem = Shell.AppSystem.get_default();
    let browserApp = appSystem.lookup_app(id);
    return browserApp;
}

function getRectForActor(actor) {
    let rect = new Clutter.Rect();
    rect.origin.x = actor.x;
    rect.origin.y = actor.y;
    rect.size.width = actor.width;
    rect.size.height = actor.height;

    return rect;
}

function blockClickEventsOnActor(actor) {
    actor.reactive = true;
    actor.connect('button-press-event', function (actor, event) {
        return true;
    });
    actor.connect('button-release-event', function (actor, event) {
        return true;
    });
}

function getSearchEngineName() {
    let path = GLib.build_filenamev([GLib.get_user_config_dir(), 'chromium', 'Default', 'Preferences']);
    let parser = new Json.Parser();

    try {
        parser.load_from_file(path);
    } catch(e if e.matches(GLib.FileError, GLib.FileError.NOENT)) {
        // User has not run Chromium yet.
        return null;
    } catch (e) {
        logError(e, 'error while parsing Chromium preferences');
        return null;
    }

    let root = parser.get_root().get_object();

    let searchProviderDataNode = root.get_member('default_search_provider_data');
    if (!searchProviderDataNode || searchProviderDataNode.get_node_type() != Json.NodeType.OBJECT) {
        return null;
    }

    let searchProviderData = searchProviderDataNode.get_object();
    if (!searchProviderData) {
        return null;
    }

    let templateUrlDataNode = searchProviderData.get_member('template_url_data');
    if (!templateUrlDataNode || templateUrlDataNode.get_node_type() != Json.NodeType.OBJECT) {
        return null;
    }

    let templateUrlData = templateUrlDataNode.get_object();
    if (!templateUrlData) {
        return null;
    }

    let shortNameNode = templateUrlData.get_member('short_name');
    if (!shortNameNode || shortNameNode.get_node_type() != Json.NodeType.VALUE) {
        return null;
    }

    return shortNameNode.get_string();
}

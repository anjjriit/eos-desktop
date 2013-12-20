// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Signals = imports.signals;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Json = imports.gi.Json;

const Config = imports.misc.config;
const Util = imports.misc.util;

const DESKTOP_GRID_ID = 'desktop';

const SCHEMA_KEY = 'icon-grid-layout';
const DESKTOP_EXT = '.desktop';
const DIRECTORY_EXT = '.directory';
const APP_DIR_NAME = 'applications';
const FOLDER_DIR_NAME = 'desktop-directories';

const DEFAULT_CONFIGS_DIR = Config.DATADIR + '/EndlessOS/personality-defaults';
const DEFAULT_CONFIG_NAME_BASE = 'icon-grid';

const DESKTOP_SUBSTITUTIONS_GROUP = 'Desktop Substitutions';

const IconGridLayout = new Lang.Class({
    Name: 'IconGridLayout',

    _init: function(params) {
        this._initSubstitutions();
        this._updateIconTree();

        global.settings.connect('changed::' + SCHEMA_KEY, Lang.bind(this, function() {
            this._updateIconTree();
            this.emit('changed');
        }));
    },

    _initSubstitutions: function() {
        this._substitutions = new GLib.KeyFile();

        try {
            this._substitutions.load_from_file(Config.DATADIR + '/EndlessOS/eos-desktop-substitutions.ini',
                                               GLib.KeyFileFlags.NONE);
        } catch (e) {
            log('Can\'t load desktop substitutions file: ' + e.message);
        }
    },

    _replaceObsolete: function(iconId) {
        let newIconId = null;

        try {
            newIconId = this._substitutions.get_string(DESKTOP_SUBSTITUTIONS_GROUP,
                                                       iconId);
        } catch (e) {
            if (!e.matches(GLib.KeyFileError, GLib.KeyFileError.KEY_NOT_FOUND) &&
                !e.matches(GLib.KeyFileError, GLib.KeyFileError.GROUP_NOT_FOUND)) {
                logError(e, 'Error fetching substitutions for id ' + iconId);
            }
        }

        return (newIconId != null) ? newIconId : iconId;
    },

    _getIconTreeFromVariant: function(allIcons) {
        let iconTree = {};

        for (let i = 0; i < allIcons.n_children(); i++) {
            let context = allIcons.get_child_value(i);
            let [folder, ] = context.get_child_value(0).get_string();
            let children = context.get_child_value(1).get_strv();
            iconTree[folder] = children.map(Lang.bind(this, this._replaceObsolete));
        }

        return iconTree;
    },

    _updateIconTree: function() {
        let allIcons = global.settings.get_value(SCHEMA_KEY);
        let nIcons = allIcons.n_children();
        let iconTree = this._getIconTreeFromVariant(allIcons);

        if (nIcons > 0 && !iconTree[DESKTOP_GRID_ID]) {
            // Missing toplevel desktop ID indicates we are reading a
            // corrupted setting. Reset grid to defaults, and let the logic
            // below run after the GSettings notification
            log('Corrupted icon-grid-layout detected, resetting to defaults');
            global.settings.reset(SCHEMA_KEY);
            return;
        }

        if (nIcons == 0) {
            // Entirely empty indicates that we need to read in the defaults
            allIcons = this._getDefaultIcons();
            iconTree = this._getIconTreeFromVariant(allIcons);
        }

        this._iconTree = iconTree;
    },

    _getDefaultIcons: function() {
        let personality = Util.getPersonality();
        let defaultsFiles = [];

        // Look for the personality-specific config file
        let specificPath = DEFAULT_CONFIGS_DIR + '/' +
            DEFAULT_CONFIG_NAME_BASE + '-' + personality + '.json';
        defaultsFiles.push(Gio.File.new_for_path(specificPath));

        // Also add a default file for fallback
        if (personality != 'default') {
            let fallbackPath = DEFAULT_CONFIGS_DIR + '/' +
                    DEFAULT_CONFIG_NAME_BASE + '-default.json';
            defaultsFiles.push(Gio.File.new_for_path(fallbackPath));
        }

        let iconTree = null;
        for (let i = 0; i < defaultsFiles.length; i++) {
            let defaultsFile = defaultsFiles[i];
            try {
                let [success, data] = defaultsFile.load_contents(null, null,
                                                                 null);
                iconTree = Json.gvariant_deserialize_data(data.toString(), -1,
                                                          'a{sas}');
                break;
            } catch (e) {
                // Print an error even if we later find the fallback, since
                // there should always be a personality-specific file
                logError(e, 'Failed to read icon grid defaults file ' +
                            defaultsFile.get_path());
            }
        }

        if (iconTree === null || iconTree.n_children() == 0) {
            log('No icon grid defaults found!');
            // At the minimum, put in something that avoids exceptions later
            iconTree = GLib.Variant.new('a{sas}', { DESKTOP_GRID_ID: [] });
        }

        return iconTree;
    },

    hasIcon: function(id) {
        for (let folderIdx in this._iconTree) {
            let folder = this._iconTree[folderIdx];
            if (folder.indexOf(id) != -1) {
                return true;
            }
        }

        return false;
    },

    getIcons: function(folder) {
        if (this._iconTree && this._iconTree[folder]) {
            return this._iconTree[folder];
        } else {
            return [];
        }
    },

    iconIsFolder: function(id) {
        return id && (id.endsWith(DIRECTORY_EXT));
    },

    appendIcon: function(id, folderId) {
        this.repositionIcon(id, null, folderId);
    },

    removeIcon: function(id) {
        this.repositionIcon(id, null, null);
    },

    listApplications: function() {
        let allApplications = [];

        for (let folderIdx in this._iconTree) {
            let folder = this._iconTree[folderIdx];
            for (let iconIdx in folder) {
                let icon = folder[iconIdx];
                if (!this.iconIsFolder(icon)) {
                    allApplications.push(icon);
                }
            }
        }

        return allApplications;
    },

    getPositionForIcon: function(id) {
        let icons;

        for (let i in this._iconTree) {
            icons = this._iconTree[i];
            let pos = icons.indexOf(id);
            if (pos != -1) {
                return [ i, pos ];
            }
        }

        return [ null, -1 ];
    },

    repositionIcon: function(id, insertId, newFolder) {
        let icons;
        let existing = false;
        let isFolder = this.iconIsFolder(id);

        for (let i in this._iconTree) {
            icons = this._iconTree[i];
            let oldPos = icons.indexOf(id);
            if (oldPos != -1) {
                icons.splice(oldPos, 1);
                existing = true;
                break;
            }
        }

        if (newFolder != null) {
            // We're adding or repositioning an icon
            icons = this._iconTree[newFolder];
            if (!icons) {
                // Invalid destination folder
                return;
            }
            this._insertIcon(icons, id, insertId);

            if (isFolder && !existing) {
                // We're adding a folder, need to initialize an
                // array for its contents
                this._iconTree[id] = [];
            }
        } else {
            // We're removing an entry
            if (isFolder && existing) {
                // We're removing a folder, need to delete the array
                // for its contents as well
                delete this._iconTree[id];
            }
        }

        // Recreate GVariant from iconTree
        let newLayout = GLib.Variant.new('a{sas}', this._iconTree);

        // Store gsetting
        global.settings.set_value(SCHEMA_KEY, newLayout);
    },

    resetDesktop: function() {
        // Reset the gsetting to restore the default layout
        global.settings.reset(SCHEMA_KEY);

        // Remove any user-specified desktop files,
        // to restore all default names
        // and clean up any unused resources
        let userPath = GLib.get_user_data_dir();
        let userDir = Gio.File.new_for_path(userPath);

        if (!userDir) {
            return;
        }

        let appDir = userDir.get_child(APP_DIR_NAME);
        if (appDir) {
            let children = appDir.enumerate_children_async(
                Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, this._enumerateDesktopFiles));
        }

        let folderDir = userDir.get_child(FOLDER_DIR_NAME);
        if (folderDir) {
            let children = folderDir.enumerate_children_async(
                Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, this._enumerateDirectoryFiles));
        }
    },

    _enumerateFiles: function(file, result, removeCallback) {
        let enumerator = file.enumerate_children_finish(result);
        enumerator.next_files_async(
            GLib.MAXINT32, GLib.PRIORITY_DEFAULT, null, removeCallback);
    },

    _enumerateDesktopFiles: function(file, result) {
        this._enumerateFiles(file, result,
                             Lang.bind(this, this._removeDesktopFiles));
    },

    _enumerateDirectoryFiles: function(file, result) {
        this._enumerateFiles(file, result,
                             Lang.bind(this, this._removeDirectoryFiles));
    },

    _removeFiles: function(enumerator, result, extension) {
        let fileInfos = enumerator.next_files_finish(result);
        for (let i = 0; i < fileInfos.length; i++) {
            let fileInfo = fileInfos[i];
            let fileName = fileInfo.get_name();
            if (fileName.endsWith(extension)) {
                let file = enumerator.get_child(fileInfo);
                file.delete_async(GLib.PRIORITY_DEFAULT, null, null);
            }
        }
    },

    _removeDesktopFiles: function(enumerator, result) {
        this._removeFiles(enumerator, result, DESKTOP_EXT);
    },

    _removeDirectoryFiles: function(enumerator, result) {
        this._removeFiles(enumerator, result, DIRECTORY_EXT);
    },

    // We use the insert Id instead of the index here since gsettings
    // includes the full application list that the desktop may have.
    // Relying on the position leads to faulty behaviour if some
    // apps are not present on the system
    _insertIcon: function(icons, id, insertId) {
        let insertIdx = -1;

        if (insertId != null) {
            insertIdx = icons.indexOf(insertId);
        }

        // We were dropped to the left of the trashcan,
        // or we were asked to append
        if (insertIdx == -1) {
            insertIdx = icons.length;
        }

        icons.splice(insertIdx, 0, id);
    }
});
Signals.addSignalMethods(IconGridLayout.prototype);

// to be used as singleton
const layout = new IconGridLayout();

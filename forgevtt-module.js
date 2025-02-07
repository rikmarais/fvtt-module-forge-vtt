/**
 * Copyright (C) 2021 - The Forge VTT Inc.
 * Author: Youness Alaoui <kakaroto@forge-vtt.com>
 * This file is part of The Forge VTT.
 * 
 * All Rights Reserved
 * 
 * NOTICE:  All information contained herein is, and remains
 * the property of The Forge VTT. The intellectual and technical concepts
 * contained herein are proprietary of its author and may be covered by
 * U.S. and Foreign Patents, and are protected by trade secret or copyright law.
 * Dissemination of this information or reproduction of this material
 * is strictly forbidden unless prior written permission is obtained
 * from the author.
 */

const THE_FORGE_ASCII_ART = `
                                                                #               
                                                              (%                
                              %%%%%                          %%/                
                             %%%%%%%%,                     %%%%         *       
                             .%%%%%%%%%%                  %%%%.     %%%         
                              #%%%%%%%%%%%              %%%%%% %%%%%%,          
                             (%%%%%%%%%%%%%        %* ,%%%%%%%%%%%%%            
                        %%%%%%%%%%%%%%%%%%%%      %%%%%%%%%%%%%%%%              
                  #%%%%%%%%%%%    %%%%%%%%%%,    %%%%%%%%%%%%%%%%%%%%%%%        
             %%%%%%%%%%%.          %%%%%%%%%%   %%%%%%%  %%%%%%%%%              
       %%%%%%%%%%%#                  %%%%      (%*       %%#                    
   (%%%%%%%%%                                                                   
    ,%%#                       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                 *%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                   %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%,        
                     %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%/    
                       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%/    
                           #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%        
                               %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                               %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%            
                                        %%%%%%%%%%%%%%%%%%                      
                                       %%%%%%%%%%%%%%%%%%%%/                    
                                     %%%%%%%%%%%%%%%%%%%%%%%%                   
                                   %%%%%%%%%%%%%%%%%%%%%%%%%%%%                 
                                ,%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%              
                           #%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%        
                                                                                 
                                     Welcome to The Forge.
`;

class ForgeVTT {
    static setupForge() {
        // Verify if we're running on the forge or not, and set things up accordingly
        this.usingTheForge = window.location.hostname.endsWith(".forge-vtt.com");
        this.HOSTNAME = "forge-vtt.com";
        this.DOMAIN = "forge-vtt.com";
        this.UPLOAD_API_ENDPOINT = `https://upload.${ForgeVTT.DOMAIN}`;
        this.FORGE_URL = `https://${this.HOSTNAME}`;
        this.ASSETS_LIBRARY_URL_PREFIX = 'https://assets.forge-vtt.com/';
        if (this.usingTheForge) {
            // Welcome!
            //console.log(THE_FORGE_ASCII_ART);
            console.log('%c     ', 'font-size:200px; background:url(https://forge-vtt.com/images/the-forge-logo-200x200.png) no-repeat;');
            console.log('%cWelcome to the Forge!', 'font-size: 40px');

            const parts = window.location.host.split(".");
            this.gameSlug = parts[0];
            this.HOSTNAME = parts.slice(1).join(".")
            this.FORGE_URL = `https://${this.HOSTNAME}`;
            this.GAME_URL = `https://${this.gameSlug}.${this.HOSTNAME}`;
            this.LIVEKIT_SERVER_URL = `livekit.${this.HOSTNAME}`;
            const local = this.HOSTNAME.match(/^(dev|local)(\.forge-vtt\.com)/);
            if (!!local) {
                this.ASSETS_LIBRARY_URL_PREFIX = `https://assets.${this.HOSTNAME}/`;
                this.DOMAIN = this.HOSTNAME;
                this.UPLOAD_API_ENDPOINT = "assets/upload";
                this._usingDevServer = true;
            }

            // Use Cloudflare proxying for the websocket for all games
            if (io?.connect) {
                const ioConnect = io.connect;
                io.connect = function(...args) {
                    if (typeof(args[0]) !== "string" && args[0]?.path === "/socket.io") {
                        args.unshift(ForgeVTT.FORGE_URL);
                    }
                    return ioConnect.apply(this, args);
                }
            }
        }
    }
    static init() {
        /* Test for Foundry bug where world doesn't load. Can be worse in 0.8.x and worse even if user has duplicate packs */
        if (window.location.pathname == "/game" && isObjectEmpty(game.data)) {
            console.warn("Detected empty world data. Reloading the page as a workaround for a Foundry bug");
            setTimeout(() => window.location.reload(), 1000);
        }

        // Register Settings
        game.settings.register("forge-vtt", "apiKey", {
            name: "API Secret Key",
            hint: "API Key to access the Forge assets library. Leave empty to use your own account while playing on The Forge. API Key is available in the My Account page.",
            scope: "client",
            config: true,
            default: "",
            type: String,
        });
        game.settings.register("forge-vtt", "lastBrowsedDirectory", {
            name: "Last Browsed Directory",
            hint: "Last Browsed Directory",
            scope: "client",
            default: "",
            type: String,
        });

        // Fix critical 0.6.6 bug
        if (ForgeVTT.foundryVersion === "0.6.6") {
            TextureLoader.prototype._attemptCORSReload  = async function (src, resolve, reject) {
                try {
                    if (src.startsWith("https://assets.forge-vtt.com/"))
                        return reject(`Failed to load texture ${src}`);
                    if ( /https?:\/\//.test(src) ) {
                        const url = new URL(src);
                        const isCrossOrigin = url.origin !== window.location.origin;
                        if ( isCrossOrigin && !/\?cors-retry=/.test(url.search) ) {
                            url.search += `?cors-retry=${Date.now()}`;
                            return this.loadImageTexture(url.href).then(tex => {
                                this.setCache(src, tex);
                                resolve(tex);
                            }).catch(reject);
                        }
                    }
                } catch (err) { }
                return reject(`Failed to load texture ${src}`);
              }
        } else {
            // Avoid the CORS retry for Forge assets library
            const original = TextureLoader.prototype._attemptCORSReload;
            if (original) {
                TextureLoader.prototype._attemptCORSReload  = async function (src, resolve, reject) {
                    try {
                        if (src.startsWith("https://assets.forge-vtt.com/"))
                            return reject(`Failed to load texture ${src}`);
                    } catch (err) {}
                    return original.call(this, src, resolve, reject).catch(reject);
                }
            }
            // Foundry 0.8.x
            if (isNewerVersion(ForgeVTT.foundryVersion, "0.8.0")) {
                // we need to do this for BaseActor and BaseMacro as well because they override the two methods but don't call `super`
                for (const klass of [foundry.abstract.Document, foundry.documents.BaseActor, foundry.documents.BaseMacro]) {
                    const preCreate = klass.prototype._preCreate;
                    klass.prototype._preCreate = async function (data, options, user) {
                        await ForgeVTT.findAndDestroyDataImages(this.documentName, data).catch(err => {});
                        return preCreate.call(this, ...arguments);
                    }
                    const preUpdate = klass.prototype._preUpdate;
                    klass.prototype._preUpdate = async function (changed, options, user) {
                        await ForgeVTT.findAndDestroyDataImages(this.documentName, changed).catch(err => {});
                        return preUpdate.call(this, ...arguments);
                    }
                }
            } else if (isNewerVersion(ForgeVTT.foundryVersion, "0.7.0")) {
                const create = Entity.create;
                Entity.create = async function (data, options) {
                    await ForgeVTT.findAndDestroyDataImages(this.entity, data).catch(err => {});
                    return create.call(this, ...arguments);
                }
                const update = Entity.update;
                Entity.update = async function (data, options) {
                    await ForgeVTT.findAndDestroyDataImages(this.entity, data).catch(err => {});
                    return update.call(this, ...arguments);
                }
            }
        }

        if (this.usingTheForge) {
            // Replacing MESSAGES allows Forge to set Forge specific strings before translations are loaded
            ForgeVTT.replaceFoundryMessages();
            // Translations are loaded after the init hook is called but may be used before the ready hook is called
            // To ensure Forge strings are available we must also replace translations on renderNotifications 
            Hooks.once('renderNotifications', () => ForgeVTT.replaceFoundryTranslations());
            if (window.location.pathname.startsWith("/join")) {
                // Add return to setup for 0.7.x
                this._addReturnToSetup();
                // Add Return to Setup to 0.8.x (hook doesn't exist in 0.7.x)
                Hooks.on('renderJoinGameForm', (obj, html) => this._addReturnToSetup(html));
            } else if (window.location.pathname.startsWith("/setup")) {
                // On v9, a request to install a package returns immediately and Foundry waits for the package installation
                // to be done asynchronously via a websocket progress signal.
                // Since we can do instant installations from the Bazaar and we can't intercept/inject signals into the websocket
                // connection from the server side, we instead hijack the `Setup.post` on the client side so if a package is installed
                // successfully and synchronsouly (a Bazaar install, not a protected content), we can fake a progress report
                // of step "Package" which vends the API result.
                if (isNewerVersion(ForgeVTT.foundryVersion, "9")) {
                    const origPost = Setup.post;
                    Setup.post = async function (data, ...args) {
                        const request = await origPost.call(this, data, ...args);
                        if (data.action === "installPackage") {
                            const response = await request.json();
                            // After reading the data, we need to replace the json method to return
                            // the json data, since it can only be called once
                            request.json = async () => response;
                            if (response.installed) {
                                // Send a fake 100% progress report with package data vending
                                this._onProgress({
                                    action: data.action,
                                    id: data.id || data.name,
                                    name: data.name,
                                    type: data.type || "module",
                                    pct: 100,
                                    step: "Package",
                                    pkg: isNewerVersion(ForgeVTT.foundryVersion, "10") ? response.data : response
                                });
                            }
                        }
                        return request;
                    }
                }
            }
            // Remove Configuration tab from /setup page
            Hooks.on('renderSetupConfigurationForm', (setup, html) => {
                html.find(`a[data-tab="configuration"],a[data-tab="update"]`).remove()
            });
            Hooks.on('renderSettings', (obj, html) => {
                const forgevtt_button = $(`<button data-action="forgevtt"><i class="fas fa-home"></i> Back to The Forge</button>`);
                forgevtt_button.click(() => window.location = `${this.FORGE_URL}/game/${this.gameSlug}`);
                const join = html.find("button[data-action=logout]");
                join.after(forgevtt_button);
                // Change "Logout" button
                if (ForgeAPI.lastStatus && ForgeAPI.lastStatus.autojoin) {
                    this._addJoinGameAs(join);
                    // Redirect the "Configure player" for autojoin games
                    $("#settings button[data-action=players]")
                        .attr("data-action", "forgevtt-players")
                        .off("click").on('click', ev => {
                            if (ForgeAPI.lastStatus.isOwner)
                                window.location.href = `${this.FORGE_URL}/setup#${this.gameSlug}&players`;
                            else
                                window.location.href = `${this.FORGE_URL}/game/${this.gameSlug}#players`;
                        });
                } else {
                    join.html(`<i class="fas fa-door-closed"></i> Back to Join Screen`);
                }
                // Remove "Return to setup" for non tables
                if (ForgeAPI.lastStatus && !ForgeAPI.lastStatus.table) {
                    html.find("button[data-action=setup]").hide();
                }
            });

            Hooks.on('renderMainMenu', (obj, html) => {
                if (!ForgeAPI.lastStatus) return;
                if (ForgeAPI.lastStatus && !ForgeAPI.lastStatus.table) {
                    html.find("li.menu-world").removeClass("menu-world").addClass("menu-forge")
                        .html(`<i class="fas fa-home"></i><h4>Back to The Forge</h4>`)
                        .off('click').click(() => window.location = `${this.FORGE_URL}/game/${this.gameSlug}`);
                }
                if (ForgeAPI.lastStatus && ForgeAPI.lastStatus.autojoin) {
                    const join = html.find("li.menu-logout").removeClass("menu-logout").addClass("menu-join-as");
                    // Don't use game.user.isGM because we could be logged in as a player
                    if (!ForgeAPI.lastStatus.isGM) {
                        return join.hide();
                    } else {
                        join.html(`<i class="fas fa-random"></i><h4>Join Game As</h4>`)
                            .off('click').click(ev => this._joinGameAs());
                    }
                } else {
                    html.find("li.menu-logout").html(`<i class="fas fa-door-closed"></i><h4>Back to Join Screen</h4>`);
                }
            });

            // Hide Legacy users when user management is enabled
            Hooks.on('renderPlayerList', (obj, html) => {
                if (!ForgeAPI.lastStatus || !ForgeAPI.lastStatus.autojoin) return;
                for (let player of html.find("li.player")) {
                    const user = game.users.get(player.dataset.userId);
                    if (user && !this._getUserFlag(user, "player")) {
                        player.remove();
                    }
                }

            });
            // TODO: Probably better to just replace the entire Application and use API to get the invite link if user is owner
            Hooks.on('renderInvitationLinks', (obj, html) => {
                html.find("form p.notes").html(`Share the below invitation links with users who you wish to have join your game.<br/>
                * The Invitation Link is for granting access to Forge users to this game (required for private games).<br/>
                * The Game URL is the direct link to this game for public games or for players who already joined it.`);
                html.find("label[for=local]").html(`<i class="fas fa-key"></i> Invitation Link`)
                html.find("label[for=remote]").html(`<i class="fas fa-share-alt"></i> Game URL`)
                if (isNewerVersion(ForgeVTT.foundryVersion, "9.0")) {
                    html.find(".show-hide").remove();
                    html.find("#remote-link").attr("type", "text").css({"flex": "3"});
                }
                obj.setPosition({ height: "auto" });
            });
            // Actor image is being updated. If token image falls back to bazaar default token, update it as well
            Hooks.on("preUpdateActor", (actor, changed) => {
                if (!changed?.img) return;
                const defaultTokenImages = [CONST.DEFAULT_TOKEN];
                defaultTokenImages.push(`${ForgeVTT.ASSETS_LIBRARY_URL_PREFIX}bazaar/core/${CONST.DEFAULT_TOKEN}`);
                const systemId = game.system.id || game.system.data?.name;
                switch (systemId) {
                    case "pf2e":
                        // Special default icons for pf2e
                        defaultTokenImages.push(`systems/pf2e/icons/default-icons/${actor.type}.svg`);
                        defaultTokenImages.push(`${ForgeVTT.ASSETS_LIBRARY_URL_PREFIX}bazaar/systems/pf2e/assets/icons/default-icons/${actor.type}.svg`);
                        break;
                    default:
                        break;
                }
                if (isNewerVersion(ForgeVTT.foundryVersion, "10") ) {
                    if (!changed.prototypeToken?.texture.src) {
                        if (!actor.prototypeToken.texture.src || defaultTokenImages.includes(actor.prototypeToken.texture.src)) {
                            setProperty(changed, "prototypeToken.texture.src", changed.img);
                        }
                    }
                } else if (!changed.token?.img) {
                    if (!actor.data.token.img || defaultTokenImages.includes(actor.data.token.img)) {
                        setProperty(changed, "token.img", changed.img);
                    }
                }
            });
            // Hook on any server activity to reset the user's activity detection
            Hooks.on('createToken', () => this._onServerActivityEvent());
            Hooks.on('updateToken', () => this._onServerActivityEvent());
            Hooks.on('createActor', () => this._onServerActivityEvent());
            Hooks.on('updateActor', () => this._onServerActivityEvent());
            Hooks.on('createJournalEntry', () => this._onServerActivityEvent());
            Hooks.on('updateJournalEntry', () => this._onServerActivityEvent());
            Hooks.on('createChatMessage', () => this._onServerActivityEvent());
            Hooks.on('canvasInit', () => this._onServerActivityEvent());
            // Start the activity checker to track player usage and prevent people from idling forever
            this._checkForActivity();
        } else {
            // Not running on the Forge
            Hooks.on('renderSettings', (app, html, data) => {
                const forgevtt_button = $(`<button class="forge-vtt" data-action="forgevtt" title="Go to ${this.FORGE_URL}"><img class="forge-vtt-icon" src="https://forge-vtt.com/images/the-forge-logo-200x200.png"> Go to The Forge</button>`);
                forgevtt_button.click(() => window.location = `${this.FORGE_URL}/`);
                const logoutButton = html.find("button[data-action=logout]");
                logoutButton.after(forgevtt_button);
            });

            if (typeof(ForgeAssetSyncApp) !== "undefined") {
                /* If we're not running on the Forge, then add the assets sync button */
                game.settings.registerMenu("forge-vtt", "assetSyncApp", {
                    name: "Asset Sync (Beta)",
                    label: "Open Asset Sync",
                    icon: "fas fa-sync",
                    hint: "Open the Forge Asset Sync app to sync Forge Assets to this Foundry server",
                    restricted: true,
                    type: ForgeAssetSyncApp
                });
            }
        }
    }

    static async setup() {
        this.injectForgeModules();

        if (game.modules.get('forge-vtt-optional')?.active) {
            // Fix Infinite duration on some uncached audio files served by Cloudflare,
            // See https://gitlab.com/foundrynet/foundryvtt/-/issues/5869#note_754029249
            // Only override this on 0.8.x and v9 as this bug should presumably be fixed in v10
            if (isNewerVersion(ForgeVTT.foundryVersion, "0.8.0") && !isNewerVersion(ForgeVTT.foundryVersion, "10")) {
                const original = AudioContainer.prototype._createAudioElement;
                AudioContainer.prototype._createAudioElement = async function(...args) {
                    const element = await original.call(this, ...args);
                    // After creating the element, if its duration was not calculated, force a time update by seeking to the end
                    if (element.duration != Infinity)  return element;
                    // Workaround for Chrome bug which may not load the duration correctly
                    return new Promise(resolve => {
                        // In case of a "live source" which would never have a duration, timeout after 5 seconds
                        const timeoutId = setTimeout(() => resolve(element), 5000);
                        // Some mp3 files will signal an `ontimeupdate`
                        element.ontimeupdate = () => {
                            element.ondurationchange = undefined;
                            element.ontimeupdate = undefined;
                            clearTimeout(timeoutId);
                            element.currentTime = 0;
                            resolve(element);
                        }
                        // Some ogg files will signal `ondurationchange` since that time can never be reached
                        element.ondurationchange = () => {
                            element.ondurationchange = undefined;
                            element.ontimeupdate = undefined;
                            clearTimeout(timeoutId);
                            element.currentTime = 0;
                            resolve(element);
                        }
                        element.currentTime = 1e101;
                    });
                }
            }
            // Add the Progressive Web App manifest and install button
            if (this.usingTheForge) {
                window.addEventListener('beforeinstallprompt', (event) => {
                    // Prevent the mini-infobar from appearing on mobile
                    event.preventDefault();
                    // Register the install menu the first time we get the event
                    if (!ForgeVTTPWA.installEvent) {
                        game.settings.registerMenu("forge-vtt-optional", "pwa", {
                            name: "Install Player Application",
                            label: "Install",
                            icon: "fas fa-download",
                            hint: "Installs a dedicated app to access your Forge game directly.",
                            restricted: false,
                            type: ForgeVTTPWA
                        });
                    }
                    ForgeVTTPWA.installEvent = event;
                });
                const link = document.createElement("LINK");
                link.rel = "manifest"
                link.href = `/pwa/manifest.json`;
                link.crossOrigin = "use-credentials";
                document.head.append(link);
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register(`/pwa/worker.js`, {scope: "/"}).catch(console.error);
                }
            }
        }
        // If user has avclient-livekit is enabled and is at least 0.4.1 (with custom server type support), then set it up to work with the Forge
        if (this.usingTheForge &&
            game.modules.get('avclient-livekit')?.active &&
            isNewerVersion(game.modules.get('avclient-livekit').data.version, "0.5")) {
            // hook on liveKitClientAvailable in 0.5.2+ as it gets called earlier and fixes issues seeing the Forge option if A/V isn't enabled yet
            const hookName = isNewerVersion(game.modules.get('avclient-livekit').data.version, "0.5.1") ? "liveKitClientAvailable" : "liveKitClientInitialized";
            // Foundry creates the client and connects it immediately without any hooks or anything to let us act on it
            // So we need to set this up on the client class itself in the setup hook before webrtc is configured
            Hooks.once(hookName, (client) => {
                const liveKitClient = isNewerVersion(game.modules.get('avclient-livekit').data.version, "0.5.1") ? client : client._liveKitClient;
                liveKitClient.addLiveKitServerType({
                    key: "forge",
                    label: "The Forge",
                    urlRequired: false,
                    usernameRequired: false,
                    passwordRequired: false,
                    url: this.LIVEKIT_SERVER_URL,
                    tokenFunction: this._getLivekitAccessToken.bind(this),
                    details: `<p>Connects to <a href="https://forums.forge-vtt.com/t/livekit-voice-and-video-chat/17792" target="_blank">The Forge's LiveKit</a> servers.</p><p>No setup necessary!</p><p><em>Requires a World Builder subscription</em></p>`
                });
            });
        }

        // For v10 and above, use Forge FilePicker to check the Assets Library when token image is wildcard
        if (isNewerVersion(ForgeVTT.foundryVersion, "10")) {
            const original = Actor._requestTokenImages;
            Actor._requestTokenImages = async function (...args) {
                const actor = game.actors.get(args[0]); // actorId
                const target = actor?.prototypeToken?.texture?.src;
                if (target) {
                    const wildcard = actor?.prototypeToken?.randomImg;
                    // Use 'data' source since the FilePicker will decide the right source to use
                    // based on whether the assets library prefix is there, or the path is in a module/system, etc...
                    const response = await ForgeVTT_FilePicker.browse("data", target, { wildcard }).catch(err => null);
                    if (response && response.files.length > 0) {
                        return response.files;
                    }
                }
                return original.apply(this, args);
            }
        }
    }

    static async ready() {
        // If on The Forge, get the status/invitation url and start heartbeat to track player usage
        if (this.usingTheForge) {
            ForgeVTT.replaceFoundryTranslations();
            game.data.addresses.local = "<Not available>";
            const status = ForgeAPI.lastStatus || await ForgeAPI.status().catch(console.error) || {};
            if (status.invitation)
                game.data.addresses.local = `${this.FORGE_URL}/invite/${this.gameSlug}/${status.invitation}`;
            game.data.addresses.remote = this.GAME_URL;
            if (isNewerVersion(ForgeVTT.foundryVersion, "9.0"))
                game.data.addresses.remoteIsAccessible = true;
            if (status.annoucements)
                this._handleAnnouncements(status.annoucements);
            // Send heartbeats for in game players
            if (window.location.pathname.startsWith("/game"))
                this._sendHeartBeat(true);
            // Remove "Return to setup" for non tables
            if (!status.table) {
                $("#settings button[data-action=setup]").hide();
            }
            if (status.autojoin) {
                $("#settings button[data-action=players]")
                    .attr("data-action", "forgevtt-players")
                    .off("click").click(ev => {
                        if (status.isOwner)
                            window.location.href = `${this.FORGE_URL}/setup#${this.gameSlug}&players`;
                        else
                            window.location.href = `${this.FORGE_URL}/game/${this.gameSlug}#players`;
                    });
                this._addJoinGameAs();
            }
            if (isNewerVersion(ForgeVTT.foundryVersion, "10")) {
                // On v10, make The Forge module appear enabled
                const moduleConfiguration = game.settings.get("core", "moduleConfiguration");
                if (!moduleConfiguration["forge-vtt"]) {
                    moduleConfiguration["forge-vtt"] = true;
                    game.settings.set("core", "moduleConfiguration", moduleConfiguration);
                }
            }
            const lastBrowsedDir = game.settings.get("forge-vtt", "lastBrowsedDirectory");
            if (lastBrowsedDir && FilePicker.LAST_BROWSED_DIRECTORY === ForgeVTT.ASSETS_LIBRARY_URL_PREFIX) {
                FilePicker.LAST_BROWSED_DIRECTORY = lastBrowsedDir;
            }

        }
    }

    static injectForgeModules() {
        // If we're running on the forge and there is no loaded module, then add a fake module
        // so the user can change the settings.
        if (!game.modules.get('forge-vtt')) {
            const data = {
                author: "The Forge",
                authors: [],
                bugs: "",
                changelog: "",
                compatibleCoreVersion: ForgeVTT.foundryVersion,
                coreTranslation: false,
                dependencies: [],
                description: "<p>This module allows players to browse their Forge Assets Library from their local games.</p><p>This module is automatically enabled for users on The Forge and is therefore not required when running your games on The Forge website.</p>",
                download: "",
                esmodules: [],
                flags: {},
                keywords: [],
                languages: [],
                license: "The Forge VTT Inc. - All Rights Reserved",
                manifest: "",
                minimumCoreVersion: undefined,
                id: "forge-vtt",
                minimumSystemVersion: undefined,
                name: "forge-vtt",
                packs: [],
                protected: false,
                readme: "",
                scripts: [],
                socket: false,
                styles: [],
                system: [],
                title: "The Forge",
                url: "https://forge-vtt.com",
                version: "1.10",
                availability: 0,
                unavailable: false
            };
            let moduleData = data;
            if (isNewerVersion(ForgeVTT.foundryVersion, "10")) {
                game.modules.set('forge-vtt', new Module({
                    active: true,
                    locked: true,
                    unavailable: false,
                    compatibility: {
                        minimum: "10",
                        verified: ForgeVTT.foundryVersion
                    },
                    ...data
                }));
                // v10 will display it in the manage modules section, so we should make it a requirement of the world.
                game.world.relationships.requires.add({type: "module", id: "forge-vtt"});
            } else {
                if (isNewerVersion(ForgeVTT.foundryVersion, "0.8.0")) {
                    moduleData = new foundry.packages.ModuleData(data);
                }
                let module = {
                    active: true,
                    availability: 0,
                    esmodules: [],
                    id: "forge-vtt",
                    languages: [],
                    locked: true,
                    packs: [],
                    path: "/forge-vtt/Data/modules/forge-vtt",
                    scripts: [],
                    styles: [],
                    type: "module",
                    unavailable: false,
                    data: moduleData
                }
                game.modules.set('forge-vtt', module);
            }
        }
        if (!game.modules.get('forge-vtt-optional') && isNewerVersion(ForgeVTT.foundryVersion, "0.8.0")) {
            const settings = game.settings.get("core", ModuleManagement.CONFIG_SETTING) || {};

            const data = {
                id: "forge-vtt-optional",
                name: "forge-vtt-optional",
                title: "The Forge: More Awesomeness",
                description: "<p>This is an optional module provided by The Forge to fix various issues and bring its own improvements to Foundry VTT. You can read more about it <a href='https://forums.forge-vtt.com/t/what-is-the-forge-optional-module/16836' target='_blank'>here</a>.</p>",
                version: "1.1",
                minimumCoreVersion: "0.8.0",
                compatibleCoreVersion: "9",
                scripts: [],
                esmodules: [],
                styles: [],
                packs: [],
                languages: [],
                authors: [],
                keywords: [],
                socket: false,
                url: "https://forge-vtt.com",
                manifest: "",
                download: "",
                license: "",
                readme: "",
                bugs: "",
                changelog: "",
                author: "The Forge",
                availability: 0,
                unavailable: false
            };
            if (isNewerVersion(ForgeVTT.foundryVersion, "10")) {
                game.modules.set('forge-vtt-optional', new Module({
                    active: settings["forge-vtt-optional"] || false,
                    availability: 0,
                    type: 'module',
                    unavailable: false,
                    path: "/forge-vtt/data/modules/forge-vtt",
                    compatibility: {
                        minimum: "10",
                        verified: ForgeVTT.foundryVersion
                    },
                    ...data
                }));
                game.data.modules.push(data);
            } else {
                let module = {
                    active: settings["forge-vtt-optional"] || false,
                    availability: 0,
                    esmodules: [],
                    id: "forge-vtt-optional",
                    languages: [],
                    locked: true,
                    packs: [],
                    path: "",
                    scripts: [],
                    styles: [],
                    type: 'module',
                    unavailable: false,
                    data: new foundry.packages.ModuleData(data)
                }
                game.modules.set('forge-vtt-optional', module);
                game.data.modules.push(module);
            }
        }

    }

    static async _getLivekitAccessToken(apiKey, secretKey, roomName, userName, metadata) {
        const status = ForgeAPI.lastStatus || await ForgeAPI.status();
        if (!status.supportsLivekit) {
            ui.notifications.error("This server does not have support for Livekit");
            return "";
        }
        if (!status.canUseLivekit) {
            ui.notifications.error("Livekit support is a feature exclusive to the World Builder tier. Please upgrade your subscription and try again.");
            return "";
        }
        const response = await ForgeAPI.call(null, {
            action: "get-livekit-credentials",
            room: roomName,
            username: userName,
            metadata
        }).catch(err => null);
        if (response && response.token) {
            if (response.server && this.LIVEKIT_SERVER_URL !== response.server) {
                this.LIVEKIT_SERVER_URL = response.server;
                // Update the url configuration in livekit avclient custom server type
                if (game.webrtc.client._liveKitClient?.liveKitServerTypes?.forge?.url) {
                    game.webrtc.client._liveKitClient.liveKitServerTypes.forge.url = this.LIVEKIT_SERVER_URL;
                }
            }
            return response.token;
        }
        ui.notifications.error(`Error retreiviving Livekit credentials: ${(response && response.error) || "Unknown Error"}.`);
        return "";
    }

    /**
     * MESSAGES[i].message represents the key that will be called from Foundry translation files
     * If the key is missing from translation files, the key itself will return as default translation value
     */
    static replaceFoundryMessages() {
        if (!MESSAGES) return;
        const forgeStrings = this._getForgeStrings();
        for (let i = 0; i < MESSAGES.length; i++) {
            const key = MESSAGES[i].message;
            if (forgeStrings[key] !== undefined) {
                MESSAGES[i].message = forgeStrings[key];
            }
        }
    }

    /**
     * Replace Foundry translations values with Forge specific strings 
     * Run after Foundry initialized abd translations are loaded, but before values are referenced
     */
    static replaceFoundryTranslations() {
        if (!game?.i18n?.translations) return;
        if (this._translationsInitialized) return;
        mergeObject(game.i18n.translations, this._getForgeStrings());
        this._translationsInitialized = true;
    }

    static async _addReturnToSetup(html) {
        // Foundry 0.8.x doesn't name the divs anymore, so we have to guess it.
        const joinForm = html ? $(html.find("section .left > div")[0]) : $("#join-form");
        // If we can't find it, hen html is null and we're running on 0.8.x, so let the onRenderJoinGame call us again
        if (joinForm.length === 0) return;

        const status = ForgeAPI.lastStatus || await ForgeAPI.status().catch(console.error) || {};
        // Add return to setup
        if (status.isOwner && status.table) {
            const button = $(`<button type="button" name="back-to-setup"><i class="fas fa-home"></i> Return to Setup</button>`);
            joinForm.append(button)
            button.click(ev => {
                // Use invalid slug world to cause it to ignore world selection
                ForgeAPI.call('game/idle', { game: this.gameSlug, force: true, world: "/"}, { cookieKey: true})
                    .then(() => window.location = "/setup")
                    .catch(err => console.error);
            })
        }
        // Add return to the forge
        const forgevtt_button = $(`<button type="button" name="back-to-forge-vtt"><i class="fas fa-hammer"></i> Back to The Forge</button>`);
        forgevtt_button.click(() => window.location = `${this.FORGE_URL}/games`);
        joinForm.append(forgevtt_button)
        // Remove "Return to Setup" section from login screen when the game is not of type Table.
        if (!status.table || status.isOwner) {
            // Foundry 0.8.x doesn't name the divs anymore, so we have to guess it.
            const shutdown = html ? $(html.find("section .left > div")[2]) : $("form#shutdown");
            shutdown.parent().css({"justify-content": "start"});
            shutdown.hide();
        }
    }

    static _addJoinGameAs(join) {
        if (!join)
            join = $("#settings button[data-action=logout]");
        // Don't use game.user.isGM because we could be logged in as a player
        if (!ForgeAPI.lastStatus.isGM) 
            return join.hide();

        join.attr("data-action", "join-as").html(`<i class="fas fa-random"></i> Join Game As`);
        join.off('click').click(ev => this._joinGameAs());
    }

    static _joinGameAs() {
        const options = [];
        // Could be logged in as someone else
        const gameusers = (isNewerVersion(ForgeVTT.foundryVersion, "9.0") ? game.users : game.users.entities);
        if (ForgeAPI.lastStatus.isGM && !this._getUserFlag(game.user, "temporary")) {

            const myUser = gameusers.find(user => this._getUserFlag(user, "player") === ForgeAPI.lastStatus.user) || game.user;
            options.push({name: `${myUser.name} (As Player)`, role: 1, id: "temp"});
        }
        for (const user of gameusers) {
            if (user.isSelf) continue;
            const id = this._getUserFlag(user, "player");
            const temp = this._getUserFlag(user, "temporary");
            if (id && !temp)
                options.push({name: user.name, role: user.role, id});
        }
        const roleToImgUrl = (role) => {     
            switch(role) {
                case 4:
                    return "/images/dice/red-d20.png";
                case 3:
                    return "/images/dice/cyan-d12.png";
                case 2:
                    return "/images/dice/purple-d10.png";
                case 1:
                    return "/images/dice/green-d8.png";
                default:
                    return null;
            }
        }
        const roleToImg = (role) => {
            const img = roleToImgUrl(role);
            if (!img) return '';
            return `<img src="${ForgeVTT.FORGE_URL}${img}" width="24" style="border: 0px; vertical-align:middle;"/>`;
        }
        const buttons = options.map(p => `<div><button data-join-as="${p.id}">${p.name} ${roleToImg(p.role)}</button></div>`).join("");
        // Close the main menu if it was open
        ui.menu.close();
        new Dialog({
            title: "Join Game As",
            content: `<p>Select a player to re-join the game as : </p>${buttons}`,
            buttons: {
            },
            render: html => {
                for (const button of html.find("button[data-join-as]")) {
                    const as = button.dataset.joinAs;
                    $(button).click(ev => window.location.href = `/join?as=${as}`)
                }
                },
            }, {height: "auto"}).render(true);
    }

    static async _checkForActivity() {
        this.activity = {
            lastX: 0,
            lastY: 0,
            mouseX: 0,
            mouseY: 0,
            keyUp: false,
            lastActive: Date.now(),
            focused: true,
            reports: [],
            events: [],
            active: true
        };
        $(window).blur(() => {
            this.activity.focused = false
        }).focus(() => {
            this.activity.focused = true
        }).on('mousemove', (ev) => {
            this.activity.mouseX = ev.clientX;
            this.activity.mouseT = ev.clientY;
        }).on('keyup', (ev) => {
            this.activity.keyUp = true;
        });

        setInterval(() => this._addActivityReport(), ForgeVTT.ACTIVITY_CHECK_INTERVAL);
        setInterval(() => this._updateActivity(), ForgeVTT.ACTIVITY_UPDATE_INTERVAL);
    }
    static _addActivityReport() {
        const report = {
            mouseMoved: this.activity.lastX !== this.activity.mouseX || this.activity.lastY !== this.activity.mouseY,
            keyboardUsed: this.activity.keyUp,
            focused: this.activity.focused
        };
        //console.log("New activity report : ", report);
        this.activity.lastX = this.activity.mouseX;
        this.activity.lastY = this.activity.mouseY;
        this.activity.keyUp = false;
        this.activity.reports.push(report);
    }
    static _updateActivity() {
        const minEvents = this.activity.reports.length / 2;
        const numEvents = this.activity.reports.reduce((acc, report) => {
            // Ignore window unfocused for now since if the player moved the mouse/keyb, it's enough
            // and they might have focus on a separate window (Beyond 20)
            if (report.mouseMoved || report.keyboardUsed)
                acc++;
            return acc;
        }, 0);
        this.activity.active = numEvents >= minEvents;
        // keep the last 100 activity events
        this.activity.events = this.activity.events.concat([this.activity.active]).slice(-100);

        this.activity.reports = [];
        if (this.activity.active) {
            this.activity.lastActive = Date.now();
        } else {
            this._verifyInactivePlayer()
        }
    }
    static _onServerActivityEvent() {
        // canvasInit gets called before ready hook
        if (!this.activity) return;
        this.activity.lastActive = Date.now();
    }

    static async _verifyInactivePlayer() {
        const inactiveFor = Date.now() - this.activity.lastActive;
        let inactiveThreshold = ForgeVTT.GAME_INACTIVE_THRESHOLD;
        if (["/game", "/stream"].includes(window.location.pathname) && game?.users) {
            if (game.users.filter(u => u.active).length <= 1)
                inactiveThreshold = ForgeVTT.GAME_SOLO_INACTIVE_THRESHOLD;
        } else {
            inactiveThreshold = ForgeVTT.OTHER_INACTIVE_THRESHOLD;
        }
        if (inactiveFor > inactiveThreshold) {
            await ForgeAPI.call(null, { action: "inactive", path: window.location.pathname, inactivity: inactiveFor }).catch(console.error);
            window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`;
        } else if (inactiveFor > inactiveThreshold - ForgeVTT.IDLE_WARN_ADVANCE) {
            this._warnInactivePlayer(inactiveFor);
        }
    }
    static _tsToH(ts) {
        const MINUTE = 60 * 1000;
        const HOUR = 60 * MINUTE;
        const time = ts > HOUR ? `${Math.round(ts / HOUR)} hour` : `${Math.round(ts / MINUTE)} minute`;
        const plural = ts > HOUR ? Math.round(ts / HOUR) > 1 : Math.round(ts / MINUTE) > 1;
        return `${time}${plural ? "s" : ""}`;
    }
    static _warnInactivePlayer(inactivity) {
        if (this.activity.warning) return;
        const redirectTS = new Date(Date.now() + ForgeVTT.IDLE_WARN_ADVANCE);
        const time = new Intl.DateTimeFormat('default', {
            hour12: true,
            hour: 'numeric',
            minute: 'numeric'
        }).format(redirectTS);

        this.activity.warning = new Dialog({
            title: "The Forge",
            content: `<div>You have been inactive for ${this._tsToH(inactivity)}.</div>
            <div>In case this is wrong, please confirm that you are still active or you will be redirected to the Forge main website in ${ this._tsToH(ForgeVTT.IDLE_WARN_ADVANCE)} (${time}).</div>`,
            buttons: {
                active: {
                    label: "I'm here!",
                    callback: () => {
                        this.activity.events.push(true);
                        this.activity.lastActive = Date.now();
                        this.activity.warning = null;
                    }
                },
                inactive: {
                    label: "You're right, take me home",
                    callback: () => {
                        window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`;
                    }
                }
            }
        }).render(true)
    }
    // Consider the user active if they had one activity event in the last HEARTBEAT_ACTIVE_IN_LAST_EVENTS events
    static _getActivity() {
        return this.activity.events.slice(-1 * ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS).some(active => active);
    }
    static async _sendHeartBeat(force) {
        const active = force || this._getActivity();
        const response = await ForgeAPI.call(null, { action: "heartbeat", active }).catch(console.error) || {};
        if (response.announcements)
            this._handleAnnouncements(response.announcements);
            
        // Redirect back in case of an expired demo license
        if (response.demo !== undefined) {
            if (response.demo < 0) {
                setTimeout(() => window.location = `https://${this.HOSTNAME}/game/${this.gameSlug}`, 2500);
            } else {
                if (this._demoTimeout)
                    clearTimeout(this._demoTimeout);
                this._demoTimeout = setTimeout(this._sendHeartBeat.bind(this), response.demo);
            }
        }

        // Send a heartbeat every 10 minutes;
        setTimeout(this._sendHeartBeat.bind(this), ForgeVTT.HEARTBEAT_TIMER);
    }

    static _handleAnnouncements(announcements) {
        this.displayedAnnouncements = this.displayedAnnouncements || [];
        const newAnnouncements = Object.keys(announcements).filter(id => !this.displayedAnnouncements.includes(id));
        for (let id of newAnnouncements) {
            ui.notifications.info(announcements[id], { permanent: true });
            this.displayedAnnouncements.push(id);
        }
    }

    // Need to use this because user.getFlag can error out if we get the forge API to respond before the init hook is called
    // causing the error of "invalid scope"
    static _getUserFlag(user, key) {
        return getProperty(user.data.flags, `forge-vtt.${key}`);
    }

    /**
     * Finds data URL for images from various entities data and replaces them a valid 
     * assets library URL.
     * This is a counter to the issue with Dungeon Alchemist that exports scenes with the
     * base64 encoded image in the json, that users import into Foundry. Causing databases
     * to quickly bloat beyond what Foundry can handle.
     */
    static async findAndDestroyDataImages(entityType, data) {
        switch (entityType) {
            case 'Actor':
                data.img = await this._uploadDataImage(entityType, data.img);
                if (data.prototypeToken) {
                    data.prototypeToken = await this.findAndDestroyDataImages('Token', data.prototypeToken);
                } else if (data.token) {
                    data.token = await this.findAndDestroyDataImages('Token', data.token);
                }
                if (data.items) {
                    data.items = await Promise.all(data.items.map(item => this.findAndDestroyDataImages('Item', item)));
                }
                if (data.data?.details?.biography?.value) {
                    data.data.details.biography.value = await this._migrateDataImageInHTML(entityType, data.data.details.biography.value);
                }
                break;
            case 'Token':
                if (data.texture) {
                    data.texture.src = await this._uploadDataImage(entityType, data.texture.src);
                } else {
                    data.img = await this._uploadDataImage(entityType, data.img);
                }
                break;
            case 'JournalEntry':
                if (data.pages) {
                    data.pages = await Promise.all(data.pages.map(page => this.findAndDestroyDataImages('JournalEntryPage', page)));
                } else {
                    data.img = await this._uploadDataImage(entityType, data.img);
                    data.content = await this._migrateDataImageInHTML(entityType, data.content);
                }
                break;
            case 'JournalEntryPage':
                data.src = await this._uploadDataImage(entityType,data.src);
                data.text.content = await this._migrateDataImageInHTML(entityType, data.text.content);
                data.text.markdown = await this._migrateDataImageInMarkdown(entityType, data.text.markdown);
                break;
            case 'Item':
                data.img = await this._uploadDataImage(entityType, data.img);
                if (data.system?.description?.value) {
                    data.system.description.value = await this._migrateDataImageInHTML(entityType, data.system.description.value);
                } else if (data.data?.description?.value) {
                    data.data.description.value = await this._migrateDataImageInHTML(entityType, data.data.description.value);
                }
                break;
            case 'Macro':
            case 'Tile':
            case 'RollTable':
                data.img = await this._uploadDataImage(entityType, data.img);
                break;
            case "Scene":
                if (data.background) {
                    data.background.src = await this._uploadDataImage(entityType, data.background.src);
                } else {
                    data.img = await this._uploadDataImage(entityType, data.img);
                }
                data.foreground = await this._uploadDataImage(entityType, data.foreground);
                data.thumb = await this._uploadDataImage(entityType, data.thumb);
                data.description = await this._migrateDataImageInHTML(entityType, data.description);
                if (data.drawings) {
                    data.drawings = await Promise.all(data.drawings.map(drawing => this.findAndDestroyDataImages('Drawing', drawing)));
                }
                if (data.notes) {
                    data.notes = await Promise.all(data.notes.map(note => this.findAndDestroyDataImages('Note', note)));
                }
                if (data.templates) {
                    data.templates = await Promise.all(data.templates.map(template => this.findAndDestroyDataImages('MeasuredTemplate', template)));
                }
                if (data.tiles) {
                    data.tiles = await Promise.all(data.tiles.map(tile => this.findAndDestroyDataImages('Tile', tile)));
                }
                if (data.tokens) {
                    data.tokens = await Promise.all(data.tokens.map(token => this.findAndDestroyDataImages('Token', token)));
                }
                break;
            case 'Drawing':
            case 'MeasuredTemplate':
                data.texture = await this._uploadDataImage(entityType, data.texture);
                break;
            case 'Note':
                data.icon = await this._uploadDataImage(entityType, data.icon);
                break;
            case "User":
                data.avatar = await this._uploadDataImage(entityType, data.avatar);
                break;
        }
        return data;
    }
    static async strReplaceAsync(str, regex, asyncFn) {
        const promises = [];
        str.replace(regex, (match, ...args) => {
            const promise = asyncFn(match, ...args);
            promises.push(promise);
        });
        const data = await Promise.all(promises);
        return str.replace(regex, () => data.shift());
    }
    static async _migrateDataImageInHTML(entityType, content) {
        if (!content) return content;
        return this.strReplaceAsync(content, /src=("[^"]+"|'[^']+')/gi, async (match, source) => {
            const src = await this._uploadDataImage(entityType, source.slice(1, -1));
            return match.substr(0, 5) + src + match.substr(-1);
        })
    }
    static async _migrateDataImageInMarkdown(entityType, content) {
        if (!content) return content;
        content = await this._migrateDataImageInHTML(entityType, content);
        return this.strReplaceAsync(content, /\[([^\]]*)\]\(([^\)]+)\)/gi, async (match, text, source) => {
            const src = await this._uploadDataImage(entityType, source)
                            .replace(/\(/g, "%28").replace(/\)/, "%29"); // escape parenthesis
            return `[${text}](${src})`;
        })
    }
    /**
     * Takes a data URL and uploads it to the assets library and returns the new URL
     * If the image is undefined, or isn't a data:image URL or upload fails, the original string will be returned
     */
    static async _uploadDataImage(entityType, img) {
        if (!img || !img.startsWith("data:image/")) return img;
        const mimetype = img.slice(11).split(",", 1)[0];
        // avoid a malformed string causing an overly long mimetype
        if (!mimetype || mimetype.length > 15) return img;
        try {
            const [ext, format] = mimetype.split(";");
            // We can use fetch to transform a data: url into a blob!
            const blob = await fetch(img).then(r => r.blob());
            const etag = await ForgeVTT_FilePicker.etagFromFile(blob);
            blob.name = `${etag}.${ext}`;

            const response = await FilePicker.upload("forgevtt", `base64data/${entityType}`, blob, {}, { notify: false });
            if (!response) return img;
            return response.path;
        } catch (err) {
            console.error(err);
            return img;
        }
    }

    static get foundryVersion() {
        return game.version || game.data.version;
    }

    static get FILE_EXTENSIONS() {
        const extensions = ["pdf", "json"]; // Some extensions that modules use that aren't part of the core media extensions
        // Add media file extensions
        if (isNewerVersion(ForgeVTT.foundryVersion, "10")) {
            extensions.push(...Object.keys(CONST.UPLOADABLE_FILE_EXTENSIONS))
        } else if (isNewerVersion(ForgeVTT.foundryVersion, "9.0")) {
            extensions.push(...Object.keys(CONST.AUDIO_FILE_EXTENSIONS),
                            ...Object.keys(CONST.IMAGE_FILE_EXTENSIONS),
                            ...Object.keys(CONST.VIDEO_FILE_EXTENSIONS));
        } else {
            extensions.push(...CONST.AUDIO_FILE_EXTENSIONS,
                            ...CONST.IMAGE_FILE_EXTENSIONS,
                            ...CONST.VIDEO_FILE_EXTENSIONS);
        }
        return extensions;
    }

    /**
     * Get Forge specific messages to replace Foundry defaults by translation key
     */
    static _getForgeStrings() {
        return {
            "ERROR.InvalidAdminKey": `The provided administrator access key is invalid. If you have forgotten your configured password you will need to change it via the Forge configuration page <a href=\"${ForgeVTT.FORGE_URL}/setup#${ForgeVTT.gameSlug}\">here</a>.`
        }
    }
}

ForgeVTT.HEARTBEAT_TIMER = 10 * 60 * 1000; // Send a heartbeat every 10 minutes to update player activity usage and get server updates
ForgeVTT.ACTIVITY_CHECK_INTERVAL = 15 * 1000; // Check for activity 15 seconds
ForgeVTT.ACTIVITY_UPDATE_INTERVAL = 60 * 1000; // Update active status every minute
ForgeVTT.GAME_INACTIVE_THRESHOLD = 2 * 60 * 60 * 1000; // A game inactive for 2 hours should be booted
ForgeVTT.GAME_SOLO_INACTIVE_THRESHOLD = 1 * 60 * 60 * 1000; // A game inactive for 1 hour with no other players should be booted
ForgeVTT.OTHER_INACTIVE_THRESHOLD = 50 * 60 * 1000; // A setup/join page inactive for 50 minutes should be booted
ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS = 10; // Send an active heartbeat if activity detected in the last ACTIVITY_UPDATE_INTERVAL events 
ForgeVTT.IDLE_WARN_ADVANCE = 20 * 60 * 1000;  // Warn the user about being inactive 20 minutes before idling the game

class ForgeVTTPWA extends FormApplication {
    async render() {
        const event = this.constructor.installEvent;
        if (!event) return;
        event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === "accepted") {
            ui.notifications.info(`Your Forge game has been installed!`);
        }
    }
}
/*
// For testing
ForgeVTT.HEARTBEAT_TIMER = 1 * 60 * 1000;
ForgeVTT.ACTIVITY_CHECK_INTERVAL = 10 * 1000;
ForgeVTT.ACTIVITY_UPDATE_INTERVAL = 60 * 1000;
ForgeVTT.GAME_INACTIVE_THRESHOLD = 3 * 60 * 1000;
ForgeVTT.OTHER_INACTIVE_THRESHOLD = 1 * 60 * 1000;
ForgeVTT.HEARTBEAT_ACTIVE_IN_LAST_EVENTS = 10;
ForgeVTT.IDLE_WARN_ADVANCE = 60 * 1000; 
*/

class ForgeAPI {

    /**
     * Send an API request
     * @param {String} endpoint               API endpoint
     * @param {FormData} formData             Form Data to send. POST if set, GET otherwise
     * @param {Object} options                Options
     * @param {String} options.method         Override API request method to use
     * @param {Function} options.progress     Progress report. function(step, percent)
     *                                        Step 0: Request started
     *                                        Step 1: Uploading request
     *                                        Step 2: Downloading response
     *                                        Step 3: Request completed
     * @param {Boolean} options.cookieKey     Force the use of the API Key from the cookies (ignoring custom key in client settings)
     */
    static async call(endpoint, formData = null, { method, progress, cookieKey } = {}) {
        return new Promise(async (resolve, reject) => {
            if (!ForgeVTT.usingTheForge && !endpoint)
                return resolve({});

            const url = endpoint ? (endpoint.startsWith("https://") ? endpoint : `${ForgeVTT.FORGE_URL}/api/${endpoint}`) : "/api/forgevtt";
            const xhr = new XMLHttpRequest();
            xhr.withCredentials = true;
            method = method || (formData ? 'POST' : 'GET');
            xhr.open(method, url);
            
            // /api/forgevtt is non authenticated (requires XSRF though) and is used to refresh cookies
            if (endpoint) {
                const apiKey = await this.getAPIKey(cookieKey);
                if (apiKey)
                    xhr.setRequestHeader('Access-Key', apiKey);
                else
                    return resolve({ code: 403, error: 'Access Unauthorized. Please enter your API key or sign in to The Forge.' });
            }
            if (method === "POST")
                xhr.setRequestHeader('X-XSRF-TOKEN', await this.getXSRFToken())

            xhr.responseType = 'json';
            if (progress) {
                xhr.onloadstart = () => progress(0, 0);
                xhr.upload.onprogress = (event) => progress(1, event.loaded / event.total);
                xhr.onprogress = (event) => progress(2, event.loaded / event.total);
            }
            xhr.onreadystatechange = () => {
                if (xhr.readyState !== 4) return;
                if (progress)
                    progress(3, 1);
                resolve(xhr.response);
            };
            xhr.onerror = (err) => {
                resolve({ code: 500, error: err.message });
            };
            if (!(formData instanceof FormData)) {
                xhr.setRequestHeader('Content-type', 'application/json; charset=utf-8');
                formData = JSON.stringify(formData);
            }
            xhr.send(formData);
        });
    }

    static async getAPIKey(cookieKey=false) {
        const apiKey = game.settings && game.settings.get("forge-vtt", "apiKey");
        if (!cookieKey && apiKey && this.isVaildAPIKey(apiKey)) return apiKey.trim();
        let cookies = this._parseCookies();
        if (this._isKeyExpired(cookies['ForgeVTT-AccessKey'])) {
            // renew site cookies
            await this.status();
            cookies = this._parseCookies();
        }
        return cookies['ForgeVTT-AccessKey'];
    }
    static async getXSRFToken() {
        let cookies = this._parseCookies();
        if (!cookies['XSRF-TOKEN']) {
            // renew site cookies
            await this.status();
            cookies = this._parseCookies();
        }
        return cookies['XSRF-TOKEN'];
    }
    static async getUserId() {
        const apiKey = await this.getAPIKey();
        if (!apiKey) return null;
        const info = this._tokenToInfo(apiKey);
        return info.id;
    }
    static _tokenToInfo(token) {
        if (!token) return {};
        try {
            return JSON.parse(atob(token.split(".")[1]));
        } catch (err) {
            return {};
        }
    }
    static _isKeyExpired(token) {
        if (!token) return true;
        const info = this._tokenToInfo(token);
        // token exp field is in epoch seconds, Date.now() is in milliseconds
        // Expire it 1 minute in advance to avoid a race where by the time the request
        // is received on the server, the key has already expired.
        return info.exp && info.exp - 60 < (Date.now() / 1000 );
    }
    static isVaildAPIKey(apiKey) {
        const info = this._tokenToInfo(apiKey);
        if (!info.id) return false;
        return !this._isKeyExpired(apiKey);
    }
    static _parseCookies() {
        return Object.fromEntries(document.cookie.split(/; */).map(c => {
            const [key, ...v] = c.split('=');
            return [key, decodeURIComponent(v.join('='))];
        }));
    }
    static async status() {
        this.lastStatus = await this.call();
        return this.lastStatus;
    }
}


class ForgeVTT_FilePicker extends FilePicker {
    constructor(...args) {
        super(...args);
        this._newFilePicker = isNewerVersion(ForgeVTT.foundryVersion, "0.5.5");
    }
    // Keep our class name proper and the Hooks with the proper names
    static get name() {
        return "FilePicker";
    }

    _inferCurrentDirectory(target) {
        if (ForgeVTT.usingTheForge && this.sources["forge-bazaar"] === undefined) {
            this.sources["forge-bazaar"] = {
                target: "",
                dirs: [],
                files: [],
                label: "The Bazaar",
                icon: "fas fa-cloud"
            }
        }
        if (this.sources["forgevtt"] === undefined) {
            this.sources["forgevtt"] = {
                target: "",
                dirs: [],
                files: [],
                label: ForgeVTT.usingTheForge ? "My Assets Library" : "The Forge Assets",
                icon: "fas fa-cloud"
            }
        }
        target = target || this.constructor.LAST_BROWSED_DIRECTORY;
        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            target = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length)
            if (ForgeVTT.usingTheForge && target.startsWith("bazaar/")) {
                const parts = target.split("/").slice(1, -1); // Remove bazaar prefix and filename from the path
                target = [parts[0], parts[1], ...parts.slice(3)].join("/"); // Remove assets folder name from the path
                return ["forge-bazaar", target]
            } else {
                target = target.split("/").slice(1, -1).join("/") // Remove userid and filename from url to get target path
                return ["forgevtt", target]
            }
        }
        if (!target)
            return ["forgevtt", ""];
        return super._inferCurrentDirectory(target);
    }

    get canUpload() {
        if (this.activeSource === "forgevtt") {
            return true;
        }
        if (this.activeSource === "forge-bazaar") {
            return false;
        }
        return !ForgeVTT.usingTheForge && super.canUpload;
    }

    async _render(...args) {
        await super._render(...args);
        const html = this.element;
        const input = html.find("input[name=file]");
        const options = $(`
        <div class="form-group stacked forgevtt-options" style="font-size: 12px;">
            <div class="form-group forgevtt-flips">
                <input type="checkbox" name="flop" id="${this.id}-forgevtt-flop">
                <label for="${this.id}-forgevtt-flop">Flip Horizontally</label>
                <input type="checkbox" name="flip" id="${this.id}-forgevtt-flip">
                <label for="${this.id}-forgevtt-flip">Flip Vertically</label>
                <input type="checkbox" name="no-optimizer" id="${this.id}-forgevtt-no-optimizer">
                <label for="${this.id}-forgevtt-no-optimizer">Disable optimizations <a href="https://forums.forge-vtt.com/t/the-image-optimizer/681">?</a></label>
            </div>
            <div class="form-group forgevtt-blur-options">
                <label for="blur">Blur Image</label>
                <select name="blur">
                    <option value="0">None</option>
                    <option value="25">25%</option>
                    <option value="50">50%</option>
                    <option value="75">75%</option>
                    <option value="100">100%</option>
                </select>
            </div>
        </div>
        `)
        options.find('input[name="no-optimizer"]').change(ev => {
            this._setURLQuery(input, "optimizer", ev.currentTarget.checked ? "disabled" : null);
        });
        options.find('input[name="flip"]').change(ev => {
            this._setURLQuery(input, "flip", ev.currentTarget.checked ? "true" : null);
        });
        options.find('input[name="flop"]').change(ev => {
            this._setURLQuery(input, "flop", ev.currentTarget.checked ? "true" : null);
        });
        options.find('select[name="blur"]').change(ev => {
            this._setURLQuery(input, "blur", ev.currentTarget.value);
        });
        options.hide();
        input.parent().after(options);
        input.on('input', this._onInputChange.bind(this, options, input));
        this._onInputChange(options, input);
        // 0.5.6 FilePicker has lazy loading of thumbnails and supports folder creation
        if (this._newFilePicker) {
            if (["forgevtt", "forge-bazaar"].includes(this.activeSource))
                html.find(`button[data-action="toggle-privacy"]`).remove();
            const images = html.find("img");
            for (let img of images.toArray()) {
                if (!img.src && img.dataset.src && img.dataset.src.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
                    try {
                        // Ask server to thumbnail the image to make display of large scene background
                        // folders easier
                        const url = new URL(img.dataset.src);
                        url.searchParams.set("height", "200");
                        img.dataset.src = url.href;
                    } catch (err) {}
                }
            }
        } else {
            if (this.constructor._newFolderDialog) {
                this.constructor._newFolderDialog.close();
                this.constructor._newFolderDialog = null;
            }
            if (this.activeSource === "forgevtt") {
                const upload = html.find("input[name=upload]");
                const uploadDiv = $(`
                <div class="form-group">
                    <button type="button" name="forgevtt-upload" style="line-height: 1rem;">
                        <i class="fas fa-upload"></i>Choose File
                    </button>
                    <button type="button" name="forgevtt-new-folder" style="line-height: 1rem;">
                        <i class="fas fa-folder-plus"></i>New Folder
                    </button>
                </div>`)
                upload.hide();
                upload.after(uploadDiv)
                uploadDiv.append(upload);
                uploadDiv.find('button[name="forgevtt-upload"]').click(ev => upload.click());
                uploadDiv.find('button[name="forgevtt-new-folder"]').click(ev => this._onNewFolder());
            }
        }
    }

    _onInputChange(options, input) {
        // FIXME: disabling the optimizer options until the feature is re-implemented
        const target = null; // input.val();
        if (!target || !target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            options.hide();
            this.setPosition({ height: "auto" })
            return;
        }
        try {
            const url = new URL(target);
            const isImage = [".jpg", ".png", ".svg"].includes(url.pathname.toLowerCase().slice(-4)) || [".jpeg", ".webp"].includes(url.pathname.toLowerCase().slice(-5))
            if (!isImage) {
                options.hide();
                this.setPosition({ height: "auto" });
                return;
            }
            const noOptimizer = url.searchParams.get('optimizer') === "disabled";
            const flip = url.searchParams.get('flip') === "true";
            const flop = url.searchParams.get('flop') === "true";
            const blur = parseInt(url.searchParams.get('blur')) || 0;
            options.find('input[name="no-optimizer"]').prop('checked', noOptimizer);
            options.find('input[name="flip"]').prop('checked', flip);
            options.find('input[name="flop"]').prop('checked', flop);
            options.find('select[name="blur"]').val(blur);
            options.show();
            this.setPosition({ height: "auto" });
        } catch (err) { }
    }

    _setURLQuery(input, query, value) {
        const target = input.val();
        if (!target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX))
            return;
        try {
            const url = new URL(target);
            if (value) url.searchParams.set(query, value);
            else url.searchParams.delete(query);
            input.val(url.href);
        } catch (err) { }
    }

    // Used for pre-0.5.6 foundry versions
    _onNewFolder(ev) {
        if (this.activeSource !== "forgevtt") return;
        if (ForgeVTT_FilePicker._newFolderDialog)
            ForgeVTT_FilePicker._newFolderDialog.close();
        const target = this.source.target;
        ForgeVTT_FilePicker._newFolderDialog = new Dialog({
            "title": "Create New Assets Folder",
            "content": `
                <div class="form-group stacked">
                    <label>Enter the name of the folder you want to create : </label>
                    <input type="text" name="folder-name"/>
                </div>
            `,
            "buttons": {
                "ok": {
                    "label": "Create Folder",
                    "icon": '<i class="fas fa-folder-plus"></i>',
                    "callback": async (html) => {
                        const name = html.find('input[name="folder-name"]').val().trim();
                        const path = `${target}/${name}`;
                        if (!name) return;
                        const response = await ForgeAPI.call('assets/new-folder', { path });
                        if (!response || response.error) {
                            ui.notifications.error(response ? response.error : "An unknown error occured accessing The Forge API");
                        } else if (response.success) {
                            ui.notifications.info("Folder created successfully")
                            this.browse(path);
                        }
                    }
                },
                "cancel": { "label": "Cancel" }
            },
            "default": "ok",
            "close": (html) => { }
        }).render(true)
    }
    _onPick(event) {
        const isFile = !event.currentTarget.classList.contains("dir");
        super._onPick(event);
        if (isFile)
            this._onInputChange(this.element.find(".forgevtt-options"), this.element.find("input[name=file]"));
    }

    static async browse(source, target, options = {}) {
        if (source === "forge-vtt") source = "forgevtt";
        // wildcard for token images hardcodes source as 'data'
        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) source = "forgevtt";
        // If user/code is browsing a package folder not in Assets Library, then check the Bazaar first
        // If the package is not accessible to the user, or the target is not found, then retry original source
        let tryingBazaarFirst = options._forgeOriginalSource;
        if (ForgeVTT.usingTheForge
            && !["forgevtt", "forge-bazaar"].includes(source)
            && !options._forgePreserveSource
            && /^\/?(modules|systems|worlds)\/.+/.test(target)) {
            tryingBazaarFirst = source;
            source = "forge-bazaar";
        }
        if (!["forgevtt", "forge-bazaar"].includes(source)) {
            if (!ForgeVTT.usingTheForge)
                options._forgePreserveSource = true;
            const resp = await super.browse(source, target, options).catch(err => {
                if (options._forgePreserveSource)
                    throw err;
            });
            if (options._forgePreserveSource || 
                (resp && (resp.target === target || resp.files.length || resp.dirs.length)))
                return resp;
            source = "forgevtt";
        }

        if (options.wildcard)
            options.wildcard = target;
        options.target = target;
        if (target.startsWith(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX)) {
            const parts = target.slice(ForgeVTT.ASSETS_LIBRARY_URL_PREFIX.length).split("/");
            // Remove userId from Assets Library URL to get target path
            target = parts.slice(1).join("/");
            options.forge_userid = parts[0];
        }
        const isFile = ForgeVTT.FILE_EXTENSIONS.some(ext => target.toLowerCase().endsWith(`.${ext}`));
        // Remove the file name and extension if the URL points to a file (wildcard will always point to file)
        if (options.wildcard || isFile) {
            target = target.split("/").slice(0, -1).join("/");
        }
        options.forge_game = ForgeVTT.gameSlug;

        // Add support for listing content from the Bazaar
        if (ForgeVTT.usingTheForge && (source === "forge-bazaar" || options.forge_userid === "bazaar")) {
            target = target.replace(/^\/+/, ''); // Remove leading dir separator
            if (target === "") {
                // Return systems/modules/worlds pseudo directories in case of the root folder
                return {
                    target: "",
                    dirs: ["modules", "systems", "worlds", "assets"],
                    files: [], 
                    gridSize: null,
                    private: false,
                    privateDirs: [],
                    extensions: options.extensions
                }
            } else {
                const parts = target.split("/");
                if (!["modules", "systems", "worlds", "assets"].includes(parts[0])) {
                    return { target, dirs: [], files: [], gridSize: null, private: false, privateDirs: [], extensions: options.extensions }
                }

            }
            options.forge_userid = "bazaar";
        }


        const response = await ForgeAPI.call('assets/browse', { path: decodeURIComponent(target), options });
        // If a target or its folder is not found in the Bazaar after checking it first, retry with original source
        if (tryingBazaarFirst && (
            !response || response.error
            // It is possible to specify a target with or without trailing "/"
            || (response.folder !== target && response.folder + "/" !== target)
            || (response.files.length === 0 && response.dirs.length === 0))) {
            if (source === "forge-bazaar") {
                // We tried the bazaar, let's try the user's assets library now
                options._forgeOriginalSource = tryingBazaarFirst;
                delete options.forge_userid;
                target = options.wildcard || options.target || target;
                return this.browse("forgevtt", target, options);
            } else {
                // Restore original target
                target = options.wildcard || options.target || target;
                return super.browse(tryingBazaarFirst, target, options)
            }
        }
        if (!response || response.error) {
            // ui or ui.notifications may still be undefined if a language (fr-core) tries to browse during the setup hook
            // to try and setup the language before the UI gets drawn.
            ui?.notifications?.error(response ? response.error : "An unknown error occured accessing The Forge API");
            return { target, dirs: [], files: [], gridSize: null, private: false, privateDirs: [], extensions: options.extensions }
        }
        // TODO: Should be decodeURIComponent but FilePicker's _onPick needs to do encodeURIComponent too, but on each separate path.
        response.target = decodeURI(response.folder);
        delete response.folder;
        response.dirs = response.dirs.map(d => d.path.slice(0, -1));
        response.files = response.files.map(f => f.url);
        // 0.5.6 specific
        response.private = true;
        response.privateDirs = [];
        response.gridSize = null;
        response.extensions = options.extensions;
        return response;
    }
    // 0.5.6 specific functions.
    static async configurePath(source, target, options={}) {
        if (["forgevtt", "forge-bazaar"].includes(source)) {
            ui.notifications.error("This feature is not supported in the Assets Library.<br/>Your Assets are all private and can be instead shared through the API Manager on your Account page on the Forge.");
            return {private: true};
        }
        return super.configurePath(source, target, options);
    }
    static async createDirectory(source, target, options={}) {
        if (source === "forge-bazaar") {
            error ="Cannot create a folder in the Bazaar";
            ui.notifications.error(error);
            throw new Error(error);
        }
        if (!ForgeVTT.usingTheForge && source !== "forgevtt")
            return super.createDirectory(source, target, options);
        if (!target) return;
        const response = await ForgeAPI.call('assets/new-folder', { path: target });
        if (!response || response.error) {
            const error = response ? response.error : "Unknown error while creating directory.";
            ui.notifications.error(error);
            throw new Error(error);
        }
    }

    async browse(target, options={}) {
        options._forgePreserveSource = true;
        const result = await super.browse(target, options);
        if (result && ["forgevtt", "forge-bazaar"].includes(this.activeSource)) {
            let path = null;
            if (this.activeSource === "forge-bazaar") {
                const parts = result.target.split("/");
                const partsWithAssets = [parts[0], parts[1], "assets", ...parts.slice(2)];
                path = `bazaar/${partsWithAssets.join("/")}`;
            } else {
                path = (await ForgeAPI.getUserId() || "user") + "/" + result.target;
            }
            this.constructor.LAST_BROWSED_DIRECTORY = ForgeVTT.ASSETS_LIBRARY_URL_PREFIX + path + "/";
            game.settings.set("forge-vtt", "lastBrowsedDirectory", this.constructor.LAST_BROWSED_DIRECTORY);

        }
        return result;
    }

    /**
     * Upload a file to the server, or alternately create and/or upload a file to the Forge
     * @param {String} source       the data source being used
     * @param {String} target       the target folder
     * @param {File} file           the File data being uploaded
     * @param {Object} options      addtional options
     */
    static async upload(source, target, file, body = {}, { notify = true } = {}) {
        if (source === "forge-bazaar") {
            ui.notifications.error("Cannot upload to that folder");
            return false;
        }
        if (!ForgeVTT.usingTheForge && source !== "forgevtt")
            return super.upload(source, target, file, body, { notify }); //in v8, body will be the options.

        // Build the asset
        const path = `${target}/${file.name}`;
        const size = file.size;
        const etag = await this.etagFromFile(file);

        // Fail if the etag can't be generated
        if (!etag) {
            ui.notifications.error("Failed to read required metadata from file");
            return false;
        }

        // Now try to create the asset
        const assetBody = { assets: [{ path, size, etag }] };
        const createResponse = await ForgeAPI.call('assets/create', assetBody);

        // If asset create call fails, prevent upload
        if (!createResponse || createResponse.error) {
            console.error(createResponse ? createResponse.error : "An unknown error occured accessing The Forge API");
            ui.notifications.error(createResponse ? createResponse.error : "An unknown error occured accessing The Forge API");
            return false;
        }

        const createResults = createResponse?.results;

        if (createResults) {
            const createResult = createResults.length ? createResults[0] : null;

            if (!createResult || createResult?.error) {
                console.error(createResult?.error ?? "Failed to create Forge asset");
                ui.notifications.error(createResult?.error ?? "Failed to create Forge asset");
                return false;
            }

            // If file already exists, prevent upload and return it
            if (createResult?.url) {
                const result = { message: "File Uploaded to your Assets Library successfully", status: "success", path: createResult?.url };
                console.info(result.message);
                if ( notify ) ui.notifications.info(result.message);
                return result;
            }
        }

        // if the url is null then we need to upload
        const formData = new FormData();
        formData.append('path', path);
        formData.append('file', file);
        const uploadResponse = await ForgeAPI.call(ForgeVTT.UPLOAD_API_ENDPOINT, formData);
        if (!uploadResponse || uploadResponse?.error) {
            console.error(uploadResponse ? uploadResponse.error : "An unknown error occured accessing The Forge API");
            ui.notifications.error(uploadResponse ? uploadResponse.error : "An unknown error occured accessing The Forge API");
            return false;
        } else {
            const result = { message: "File Uploaded to your Assets Library successfully", status: "success", path: uploadResponse.url };
            console.info(result.message);
            if ( notify ) ui.notifications.info(result.message);
            return result;
        }
    }

    /**
     * Upload many files to the Forge user's assets library, at once.
     *
     * @param {String} source           Must be "forgevtt"
     * @param {Array<Object>} files     Array of objects of the form: {target, file}
     * @returns {Array<String>}         Array of urls or null values if unable to upload (or returns null in case of error)
     */
    static async _uploadMany(source, files, { notify = true } = {}) {
        if (!ForgeVTT.usingTheForge && source !== "forgevtt") {
            throw new Error("Can only use uploadMany on forgevtt source");
        }
        const CREATE_BATCH_SIZE = 100;
        const createResults = [];
        // Try to first create the files in batches of 100
        for (let i = 0; i < files.length; i += CREATE_BATCH_SIZE) {
            const batch = files.slice(i, i + CREATE_BATCH_SIZE);

            const assetBody = await Promise.all(batch.map(async ({target, file}) => {
                // Build the asset
                const path = `${target}/${file.name}`;
                const size = file.size;
                const etag = await this.etagFromFile(file);

                // If the etag can't be generated, server side will fail the upload
                return { path, size, etag };
            }));

            // Now try to create the asset
            const create = { assets: assetBody };
            const createResponse = await ForgeAPI.call('assets/create', create);
            // If asset create call fails, prevent upload
            if (!createResponse || createResponse.error) {
                console.error(createResponse ? createResponse.error : "An unknown error occured accessing The Forge API");
                ui.notifications.error(createResponse ? createResponse.error : "An unknown error occured accessing The Forge API");
                return null;
            }
            createResults.push(...createResponse.results);
        }
        // Find which files failed to be created and upload them instead
        const UPLOAD_BATCH_SIZE = 50 * 1024 * 1024; // In body size
        const uploadResults = [];
        let formData = new FormData();
        let size = 0;
        for (let i = 0; i < files.length; i++) {
            const createResult = createResults[i];
            // If we have an error, then upload will fail, and if we have a url, creation succeeded
            // Only upload files where the result has a url of null
            if (createResult.error || createResult.url !== null) continue;
            const {target, file} = files[i];
            formData.append("paths[]", `${target}/${file.name}`);
            formData.append("files[]", file, file.name);
            size += file.size;
            if (size > UPLOAD_BATCH_SIZE) {
                const uploadResponse = await ForgeAPI.call(ForgeVTT.UPLOAD_API_ENDPOINT, formData);
                if (!uploadResponse || uploadResponse?.error) {
                    console.error(uploadResponse ? uploadResponse.error : "An unknown error occured accessing The Forge API");
                    ui.notifications.error(uploadResponse ? uploadResponse.error : "An unknown error occured accessing The Forge API");
                    return null;
                }
                uploadResults.push(...uploadResponse.results);
                size = 0;
                formData = new FormData();
            }
        }
        if (size > 0) {
            const uploadResponse = await ForgeAPI.call(ForgeVTT.UPLOAD_API_ENDPOINT, formData);
            if (!uploadResponse || uploadResponse?.error) {
                console.error(uploadResponse ? uploadResponse.error : "An unknown error occured accessing The Forge API");
                ui.notifications.error(uploadResponse ? uploadResponse.error : "An unknown error occured accessing The Forge API");
                return null;
            }
            uploadResults.push(...uploadResponse.results)
        }
        // Build the response based on creation+upload results
        const result = createResults.map(result => {
            if (result.error) return null;
            if (result.url) return result.url;
            // No error and no url, so it was uploaded
            const uploadResult = uploadResults.shift();
            return uploadResult.url || null;
        });
        const uploaded = result.filter(r => !!r).length;
        if ( notify ) ui.notifications.info(`Successfully uploaded ${uploaded}/${result.length} files to your Assets Library`);
        return result;
    }

    // Need to override fromButton because it references itself, so it creates the original
    // FilePicker instead of this derived class
    static fromButton(...args) {
        const fp = super.fromButton(...args);
        if (!fp) return fp;
        // Can't use fp.options because fp.options.field becomes an object due to mergeObject, not a jquery
        return new ForgeVTT_FilePicker({
            field: fp.field,
            type: fp.type,
            current: fp.request,
            button: fp.button
        });
    }

    static async loadScript(url) {
        return new Promise((resolve, reject) => {
            const head = document.getElementsByTagName('head')[0];
            const script = document.createElement('script');
            script.onload = resolve;
            script.onerror = reject;
            script.src = url;
            head.appendChild(script);
        });
    }
    static async loadMD5Library() {
        if (typeof(SparkMD5) !== "undefined") return;
        if (ForgeVTT.usingTheForge) {
            return this.loadScript("https://forge-vtt.com/lib/spark-md5.js");
        } else {
            return this.loadScript("/modules/forge-vtt/lib/spark-md5/md5.min.js");
        }
    }

    static async etagFromFile(file, progress = null) {
        await this.loadMD5Library();
        return new Promise((resolve, reject) => {
            let blobSlice = File.prototype.slice || File.prototype.mozSlice || File.prototype.webkitSlice,
                chunkSize = 5 * 1024 * 1024,     // Read in chunks of 5MB
                chunks = Math.ceil(file.size / chunkSize),
                currentChunk = 0,
                spark = new SparkMD5.ArrayBuffer(),
                fileReader = new FileReader(),
                sparkMulti = null;

            if (progress) progress(0);
            fileReader.onload = function (e) {
                spark.append(e.target.result);                   // Append array buffer
                currentChunk++;

                if (progress) progress(currentChunk / chunks);
                if (currentChunk < chunks) {
                    if (!sparkMulti) sparkMulti = new SparkMD5();
                    sparkMulti.appendBinary(spark.end(true))
                    spark.reset();
                    loadNext();
                } else {
                    if (sparkMulti) {
                        sparkMulti.appendBinary(spark.end(true))
                        resolve(`${sparkMulti.end()}-${chunks}`);
                    } else {
                        resolve(spark.end());
                    }
                }
            };

            fileReader.onerror = function (err) {
                reject(err);
            };

            function loadNext() {
                var start = currentChunk * chunkSize,
                    end = ((start + chunkSize) >= file.size) ? file.size : start + chunkSize;

                fileReader.readAsArrayBuffer(blobSlice.call(file, start, end));
            }

            loadNext();
        });
    }
}

// Hook the file picker to add My Assets Library to it
FilePicker = ForgeVTT_FilePicker;

Hooks.on('init', () => ForgeVTT.init());
Hooks.on('setup', () => ForgeVTT.setup());
Hooks.on('ready', () => ForgeVTT.ready());
ForgeVTT.setupForge();

FilePicker.LAST_BROWSED_DIRECTORY = ForgeVTT.usingTheForge ? ForgeVTT.ASSETS_LIBRARY_URL_PREFIX : "";

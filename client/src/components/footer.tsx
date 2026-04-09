import { useContext, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ClientConfigContext } from '../state/config';
import { Helmet } from "react-helmet";
import { siteName } from '../utils/constants';
import { buildLoginPath, HIDDEN_LOGIN_REDIRECT } from "../utils/auth-redirect";

type ThemeMode = 'light' | 'dark' | 'system';

function Footer() {
    const [, setLocation] = useLocation();
    const [modeState, setModeState] = useState<ThemeMode>('system');
    const config = useContext(ClientConfigContext);
    const loginEnabled = config.getBoolean('login.enabled');
    const [doubleClickTimes, setDoubleClickTimes] = useState(0);

    useEffect(() => {
        const mode = localStorage.getItem('theme') as ThemeMode || 'system';
        setModeState(mode);
        setMode(mode);
    }, []);

    const setMode = (mode: ThemeMode) => {
        setModeState(mode);
        localStorage.setItem('theme', mode);

        if (mode !== 'system') {
            document.documentElement.setAttribute('data-color-mode', mode);
        } else {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            document.documentElement.setAttribute('data-color-mode', mediaQuery.matches ? 'dark' : 'light');
        }
        window.dispatchEvent(new Event("colorSchemeChange"));
    };

    return (
        <footer className="w-full bg-neutral-950 py-12 text-neutral-300">
            <Helmet>
                <link rel="alternate" type="application/rss+xml" title={siteName} href="/rss.xml" />
            </Helmet>
            
            <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 gap-8 px-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="flex flex-col gap-4">
                    <div className="text-sm font-semibold text-neutral-200">{siteName}</div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] font-medium text-neutral-400">
                        <a className="hover:text-neutral-200" href="/rss.xml">RSS</a>
                        <a className="hover:text-neutral-200" href="/about">About</a>
                        <a className="hover:text-neutral-200" href="/friends">Friends</a>
                        <a className="hover:text-neutral-200" href="/hashtags">Hashtags</a>
                    </div>
                    <p className="text-xs leading-5 text-neutral-500">
                        <span
                            className="cursor-default"
                            onDoubleClick={() => {
                                if (doubleClickTimes >= 2) {
                                    setDoubleClickTimes(0);
                                    if (!loginEnabled) setLocation(buildLoginPath(HIDDEN_LOGIN_REDIRECT));
                                } else {
                                    setDoubleClickTimes(doubleClickTimes + 1);
                                }
                            }}
                        >
                            &copy; {new Date().getFullYear()} Your Company. All rights reserved.
                        </span>
                    </p>
                </div>

                <div className="flex items-center justify-start gap-5 md:justify-end">
                    <SocialIcon href="#" icon="ri-facebook-fill" label="Facebook" />
                    <SocialIcon href="#" icon="ri-instagram-line" label="Instagram" />
                    <SocialIcon href="#" icon="ri-twitter-x-fill" label="X" />
                    <SocialIcon href="#" icon="ri-github-fill" label="GitHub" />
                    <SocialIcon href="#" icon="ri-youtube-fill" label="YouTube" />
                    <button
                        onClick={() => setMode(modeState === 'dark' ? 'light' : 'dark')}
                        className="text-neutral-400 hover:text-neutral-200"
                        aria-label="Toggle theme"
                    >
                        <i className={modeState === 'dark' ? 'ri-sun-line' : 'ri-moon-line'}></i>
                    </button>
                </div>
            </div>
        </footer>
    );
}

function SocialIcon({ href, icon, label }: { href: string, icon: string, label: string }) {
    return (
        <a href={href} className="text-neutral-400 hover:text-neutral-200" target="_blank" rel="noreferrer">
            <span className="sr-only">{label}</span>
            <i className={`${icon} text-xl`}></i>
        </a>
    );
}

export default Footer;
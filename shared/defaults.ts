// Data bawaan (seed) — kategori situs, daftar domain, profil kebijakan, konfigurasi Google Search.
// Daftar ini DAPAT DIUBAH admin melalui dashboard; seed hanya dipakai saat inisialisasi.

export interface SeedCategory {
  slug: string;
  name: string;
  description: string;
  core: boolean; // kebijakan keamanan inti (hanya Super Admin)
  domains: string[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    slug: 'video-streaming', name: 'Video dan Streaming', core: false,
    description: 'YouTube, TikTok, Twitch, Netflix, dan layanan streaming lain beserta CDN pendukung.',
    domains: [
      'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'ytimg.com', 'googlevideo.com', 'youtubei.googleapis.com', 'yt3.ggpht.com', 'youtubekids.com',
      'tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'tiktokcdn-us.com', 'tiktokw.us', 'byteoversea.com', 'ibytedtos.com', 'ibyteimg.com', 'muscdn.com', 'musical.ly',
      'twitch.tv', 'ttvnw.net', 'jtvnw.net', 'netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxext.com', 'nflxso.net',
      'vidio.com', 'viu.com', 'iq.com', 'wetv.vip', 'dailymotion.com', 'vimeo.com', 'bilibili.tv', 'disneyplus.com', 'primevideo.com', 'hotstar.com',
    ],
  },
  {
    slug: 'social-media', name: 'Media Sosial', core: false,
    description: 'Facebook, Instagram, X/Twitter, Snapchat, Threads, Pinterest, Reddit.',
    domains: [
      'facebook.com', 'fb.com', 'fbcdn.net', 'fb.me', 'messenger.com', 'instagram.com', 'cdninstagram.com', 'threads.net', 'threads.com',
      'twitter.com', 'x.com', 't.co', 'twimg.com', 'snapchat.com', 'sc-cdn.net', 'snap.com', 'pinterest.com', 'pinimg.com', 'reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com',
      'discord.com', 'discord.gg', 'discordapp.com', 'telegram.org', 't.me', 'web.whatsapp.com', 'linkedin.com', 'tumblr.com',
    ],
  },
  {
    slug: 'games', name: 'Permainan Online', core: false,
    description: 'Situs dan platform permainan online.',
    domains: ['roblox.com', 'rbxcdn.com', 'steampowered.com', 'steamcommunity.com', 'epicgames.com', 'miniclip.com', 'poki.com', 'crazygames.com', 'friv.com', 'y8.com', 'garena.com', 'mobilelegends.com', 'pubg.com', 'chess.com', 'agar.io', 'krunker.io', 'minecraft.net'],
  },
  {
    slug: 'entertainment', name: 'Hiburan, Film, dan Musik', core: false,
    description: 'Situs film, video hiburan, musik streaming, dan hiburan lain.',
    domains: ['spotify.com', 'scdn.co', 'joox.com', 'soundcloud.com', 'deezer.com', 'music.apple.com', '9gag.com', 'imdb.com', 'webtoons.com', 'wattpad.com', 'detik.com', 'kompas.tv'],
  },
  {
    slug: 'proxy-vpn', name: 'Proxy, VPN, dan Anonymizer', core: true,
    description: 'Layanan proxy, VPN tidak resmi, anonymizer, web proxy. Termasuk kebijakan keamanan inti.',
    domains: [
      'hidemyass.com', 'hide.me', 'proxysite.com', 'croxyproxy.com', 'kproxy.com', 'hidester.com', 'whoer.net', 'vpnbook.com', 'protonvpn.com', 'nordvpn.com',
      'expressvpn.com', 'surfshark.com', 'windscribe.com', 'tunnelbear.com', 'psiphon.ca', 'psiphon3.com', 'ultrasurf.us', 'torproject.org', 'hotspotshield.com', 'urban-vpn.com', 'touchvpn.net', '1clickvpn.com',
    ],
  },
  {
    slug: 'doh-resolvers', name: 'DNS over HTTPS Publik', core: true,
    description: 'Endpoint DoH publik yang dapat dipakai untuk melewati filter DNS. Kebijakan keamanan inti.',
    domains: ['dns.google', 'cloudflare-dns.com', 'mozilla.cloudflare-dns.com', 'one.one.one.one', 'dns.quad9.net', 'doh.opendns.com', 'dns.adguard.com', 'dns.nextdns.io', 'doh.cleanbrowsing.org', 'dns.adguard-dns.com'],
  },
  {
    slug: 'google-apps', name: 'Layanan Google Selain Search', core: false,
    description: 'Gmail, Drive, Docs, Photos, Gemini, dan aplikasi Google lain. Tidak termasuk izin Google Search.',
    domains: [
      'mail.google.com', 'drive.google.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com', 'photos.google.com', 'gemini.google.com', 'bard.google.com',
      'meet.google.com', 'chat.google.com', 'keep.google.com', 'calendar.google.com', 'sites.google.com', 'play.google.com', 'news.google.com', 'maps.google.com',
      'translate.google.com', 'classroom.google.com', 'books.google.com', 'earth.google.com', 'aistudio.google.com', 'notebooklm.google.com', 'gmail.com', 'googledrive.com', 'photos.app.goo.gl',
    ],
  },
];

/** Hostname Google Search yang diizinkan (dapat dikonfigurasi di Pengaturan). */
export const DEFAULT_GOOGLE_SEARCH_HOSTS = ['www.google.com', 'google.com', 'www.google.co.id', 'google.co.id'];

/**
 * Host resource statis yang dibutuhkan halaman pencarian Google (DNS harus me-resolve-nya).
 * Catatan: URLBlocklist Chrome diterapkan pada navigasi (frame), bukan setiap sub-resource,
 * sehingga host ini terutama diperlukan untuk lapisan DNS default-deny.
 */
export const DEFAULT_GOOGLE_RESOURCE_HOSTS = [
  'www.gstatic.com', 'ssl.gstatic.com', 'fonts.gstatic.com', 'encrypted-tbn0.gstatic.com', 'encrypted-tbn1.gstatic.com',
  'encrypted-tbn2.gstatic.com', 'encrypted-tbn3.gstatic.com', 'fonts.googleapis.com', 'apis.google.com', 'consent.google.com', 'id.google.com',
];

/** Path di host Google Search yang BUKAN bagian pencarian dan diblokir secara eksplisit. */
export const DEFAULT_GOOGLE_BLOCKED_PATHS = ['/maps', '/drive', '/travel', '/flights', '/hotels', '/finance', '/shopping', '/books', '/save', '/collections', '/alerts', '/bookmarks', '/gmail', '/photos', '/intl/id/drive', '/intl/en/drive'];

/** Host Google yang tidak boleh ditambahkan lewat diagnostik resource (aplikasi, bukan resource). */
export const PROTECTED_GOOGLE_APP_PREFIXES = ['mail.', 'drive.', 'docs.', 'sheets.', 'slides.', 'photos.', 'gemini.', 'bard.', 'meet.', 'chat.', 'keep.', 'calendar.', 'sites.', 'play.', 'news.', 'maps.', 'aistudio.', 'notebooklm.', 'accounts.', 'myaccount.', 'youtube', 'classroom.'];

/** IP resolver DoH/DoT publik — diblokir di firewall (port 443/853) agar DNS tidak bisa di-bypass. */
export const DEFAULT_DOH_RESOLVER_IPS = [
  '8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9', '149.112.112.112', '208.67.222.222', '208.67.220.220',
  '94.140.14.14', '94.140.15.15', '185.228.168.168', '185.228.169.168', '45.90.28.0', '45.90.30.0',
];

export const FORCE_SAFESEARCH_IPV4 = '216.239.38.120';
export const FORCE_SAFESEARCH_IPV6 = '2001:4860:4802:32::78';

export type PolicyType = 'GOOGLE_SEARCH_ONLY' | 'LEARNING' | 'FULL_LOCK' | 'CUSTOM';

export interface SeedPolicy {
  key: string;
  name: string;
  type: PolicyType;
  description: string;
  googleSearch: boolean;
  includeGlobalAllowlist: boolean;
  blockedCategorySlugs: string[];
  allowedDomains: string[];
  ipEnforcement: boolean;
}

export const SEED_POLICIES: SeedPolicy[] = [
  {
    key: 'google-search-only', name: 'GOOGLE SEARCH ONLY', type: 'GOOGLE_SEARCH_ONLY',
    description: 'Hanya Google Search (SafeSearch wajib). Semua situs lain ditolak secara default, termasuk layanan Google lain.',
    googleSearch: true, includeGlobalAllowlist: false, ipEnforcement: false,
    blockedCategorySlugs: ['video-streaming', 'social-media', 'games', 'entertainment', 'proxy-vpn', 'doh-resolvers', 'google-apps'], allowedDomains: [],
  },
  {
    key: 'learning-mode', name: 'LEARNING MODE', type: 'LEARNING',
    description: 'Google Search + website pembelajaran yang disetujui admin (daftar izin global). Hiburan tetap diblokir.',
    googleSearch: true, includeGlobalAllowlist: true, ipEnforcement: false,
    blockedCategorySlugs: ['video-streaming', 'social-media', 'games', 'entertainment', 'proxy-vpn', 'doh-resolvers'], allowedDomains: [],
  },
  {
    key: 'full-lock', name: 'FULL INTERNET LOCK', type: 'FULL_LOCK',
    description: 'Seluruh akses internet peserta didik dinonaktifkan. Layanan jaringan lokal tetap dapat diakses.',
    googleSearch: false, includeGlobalAllowlist: false, ipEnforcement: true,
    blockedCategorySlugs: ['proxy-vpn', 'doh-resolvers'], allowedDomains: [],
  },
];

export const SEED_LEARNING_SITES = ['kemdikbud.go.id', 'belajar.kemdikbud.go.id', 'wikipedia.org', 'id.wikipedia.org', 'kbbi.kemdikbud.go.id', 'khanacademy.org', 'rumahbelajar.id', 'geogebra.org', 'phet.colorado.edu'];

export const TIMEZONE = 'Asia/Jakarta';

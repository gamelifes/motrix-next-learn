#!/usr/bin/env python3
"""Batch-add the m3u8 unsupported-stream reason keys to all 27 locale task files.

Inserts `m3u8-live-stream` and `m3u8-master-playlist` directly after the
`'m3u8-merge-failed'` line. Idempotent: skips locales that already contain the
`m3u8-live-stream` key. Writes with LF line endings to keep diffs minimal.

Usage: python scripts/add-m3u8-live-locale-keys.py
"""
import os

LOCALES_DIR = "src/shared/locales"
LOCALE_NAMES = [
    "ar", "bg", "ca", "de", "el", "en-US", "es", "fa", "fr", "hi", "hu", "id",
    "it", "ja", "ko", "nb", "nl", "pl", "pt-BR", "ro", "ru", "th", "tr", "uk",
    "vi", "zh-CN", "zh-TW",
]

TRANSLATIONS = {
    "ar": ("'m3u8-live-stream': 'البث المباشر غير مدعوم',",
           "'m3u8-master-playlist': 'قائمة التشغيل الرئيسية غير مدعومة. استخدم رابط قائمة تشغيل وسائط مباشر.',"),
    "bg": ("'m3u8-live-stream': 'Потоковите предавания не се поддържат',",
           "'m3u8-master-playlist': 'Основните плейлисти не се поддържат. Използвайте директен URL за медия плейлист.',"),
    "ca": ("'m3u8-live-stream': 'Les emissions en directe no són compatibles',",
           "'m3u8-master-playlist': 'Els llistats mestre no són compatibles. Utilitzeu un URL de llista de reproducció de mitjans directa.',"),
    "de": ("'m3u8-live-stream': 'Live-Streams werden nicht unterstützt',",
           "'m3u8-master-playlist': 'Master-Wiedergabelisten werden nicht unterstützt. Verwenden Sie eine direkte Medien-Wiedergabelisten-URL.',"),
    "el": ("'m3u8-live-stream': 'Οι ζωντανές μεταδόσεις δεν υποστηρίζονται',",
           "'m3u8-master-playlist': 'Οι κύριες λίστες αναπαραγωγής δεν υποστηρίζονται. Χρησιμοποιήστε έναν άμεσο σύνδεσμο λίστας αναπαραγωγής μέσων.',"),
    "en-US": ("'m3u8-live-stream': 'Live streams are not supported',",
              "'m3u8-master-playlist': 'Master playlists are not supported. Use a direct media playlist URL.',"),
    "es": ("'m3u8-live-stream': 'Las transmisiones en vivo no son compatibles',",
           "'m3u8-master-playlist': 'Las listas de reproducción maestras no son compatibles. Usa una URL de lista de reproducción de medios directa.',"),
    "fa": ("'m3u8-live-stream': 'پخش زنده پشتیبانی نمیشود',",
           "'m3u8-master-playlist': 'فهرست پخش اصلی پشتیبانی نمیشود. از آدرس مستقیم فهرست پخش رسانهای استفاده کنید.',"),
    "fr": ("'m3u8-live-stream': 'Les flux en direct ne sont pas pris en charge',",
           "'m3u8-master-playlist': 'Les playlists maîtres ne sont pas prises en charge. Utilisez une URL de playlist média directe.',"),
    "hi": ("'m3u8-live-stream': 'लाइव स्ट्रीम समर्थित नहीं हैं',",
           "'m3u8-master-playlist': 'मास्टर प्लेलिस्ट समर्थित नहीं हैं। सीधा मीडिया प्लेलिस्ट URL उपयोग करें।',"),
    "hu": ("'m3u8-live-stream': 'Az élő közvetítések nem támogatottak',",
           "'m3u8-master-playlist': 'A fő lejátszási listák nem támogatottak. Használjon közvetlen média lejátszási lista URL-t.',"),
    "id": ("'m3u8-live-stream': 'Siaran langsung tidak didukung',",
           "'m3u8-master-playlist': 'Daftar putar utama tidak didukung. Gunakan URL daftar putar media langsung.',"),
    "it": ("'m3u8-live-stream': 'Gli streaming live non sono supportati',",
           "'m3u8-master-playlist': 'Le playlist master non sono supportate. Usa un URL di playlist media diretto.',"),
    "ja": ("'m3u8-live-stream': 'ライブ配信はサポートされていません',",
           "'m3u8-master-playlist': 'マスター再生リストはサポートされていません。直接のメディア再生リストURLを使用してください。',"),
    "ko": ("'m3u8-live-stream': '라이브 스트림은 지원되지 않습니다',",
           "'m3u8-master-playlist': '마스터 재생목록은 지원되지 않습니다. 직접 미디어 재생목록 URL을 사용하세요.',"),
    "nb": ("'m3u8-live-stream': 'Direktestrømming støttes ikke',",
           "'m3u8-master-playlist': 'Master-spillelister støttes ikke. Bruk en direkte mediespilleliste-URL.',"),
    "nl": ("'m3u8-live-stream': 'Live-streams worden niet ondersteund',",
           "'m3u8-master-playlist': 'Master-afspeellijsten worden niet ondersteund. Gebruik een directe media-afspeellijst-URL.',"),
    "pl": ("'m3u8-live-stream': 'Transmisje na żywo nie są obsługiwane',",
           "'m3u8-master-playlist': 'Listy główne nie są obsługiwane. Użyj bezpośredniego adresu URL listy multimediów.',"),
    "pt-BR": ("'m3u8-live-stream': 'Transmissões ao vivo não são suportadas',",
              "'m3u8-master-playlist': 'Listas de reprodução mestras não são suportadas. Use uma URL de lista de reprodução de mídia direta.',"),
    "ro": ("'m3u8-live-stream': 'Streamingul live nu este acceptat',",
           "'m3u8-master-playlist': 'Playlistele master nu sunt acceptate. Folosiți un URL direct de playlist media.',"),
    "ru": ("'m3u8-live-stream': 'Прямые трансляции не поддерживаются',",
           "'m3u8-master-playlist': 'Мастер-плейлисты не поддерживаются. Используйте прямой URL медиа-плейлиста.',"),
    "th": ("'m3u8-live-stream': 'ไม่รองรับสตรีมสด',",
           "'m3u8-master-playlist': 'ไม่รองรับเพลย์ลิสต์หลัก ใช้ URL เพลย์ลิสต์สื่อโดยตรงแทน',"),
    "tr": ("'m3u8-live-stream': 'Canlı yayınlar desteklenmiyor',",
           "'m3u8-master-playlist': 'Ana oynatma listeleri desteklenmez. Doğrudan bir medya oynatma listesi URL\\'si kullanın.',"),
    "uk": ("'m3u8-live-stream': 'Прямі трансляції не підтримуються',",
           "'m3u8-master-playlist': 'Основні списки відтворення не підтримуються. Використовуйте прямий URL-адрес медіа-списку відтворення.',"),
    "vi": ("'m3u8-live-stream': 'Không hỗ trợ phát trực tiếp',",
           "'m3u8-master-playlist': 'Danh sách phát chính không được hỗ trợ. Vui lòng dùng URL danh sách phát phương tiện trực tiếp.',"),
    "zh-CN": ("'m3u8-live-stream': '不支持直播流',",
              "'m3u8-master-playlist': '不支持主播放列表，请使用直接的媒体播放列表链接。',"),
    "zh-TW": ("'m3u8-live-stream': '不支援直播串流',",
              "'m3u8-master-playlist': '不支援主播放清單，請使用直接的媒體播放清單連結。',"),
}


def update_locale(locale_dir, values):
    filepath = os.path.join(LOCALES_DIR, locale_dir, "task.js")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    if "'m3u8-live-stream'" in content:
        print(f"Skip {locale_dir} (already updated)")
        return
    anchor = "'m3u8-merge-failed'"
    idx = content.find(anchor)
    if idx == -1:
        print(f"ERROR: anchor not found in {locale_dir}")
        return
    line_end = content.find("\n", idx)
    insert_pos = line_end + 1
    new_content = content[:insert_pos] + "\n".join(values) + "\n" + content[insert_pos:]
    with open(filepath, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_content)
    print(f"Updated {locale_dir}")


for locale_dir in LOCALE_NAMES:
    update_locale(locale_dir, TRANSLATIONS[locale_dir])
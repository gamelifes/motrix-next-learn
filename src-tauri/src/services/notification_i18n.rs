//! Localised strings for Rust-side task notifications.
//!
//! This table intentionally owns the small subset of notification strings
//! required while the WebView is destroyed.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TaskNotificationTexts {
    pub download_start_title: &'static str,
    pub download_start_body: &'static str,
    pub download_batch_start_body: &'static str,
    pub download_complete_title: &'static str,
    pub download_complete_body: &'static str,
    pub bt_complete_title: &'static str,
    pub bt_complete_body: &'static str,
    pub ed2k_complete_title: &'static str,
    pub ed2k_complete_body: &'static str,
    pub download_failed_title: &'static str,
    pub download_failed_body: &'static str,
    pub error_unknown: &'static str,
}

const EN_US_TEXTS: TaskNotificationTexts = TaskNotificationTexts {
    download_start_title: "Download Started",
    download_start_body: "Started downloading \"{taskName}\"",
    download_batch_start_body: "Started downloading \"{taskName}\" and {count} other task(s)",
    download_complete_title: "Download Complete",
    download_complete_body: "Saved: {taskName}",
    bt_complete_title: "BT Download Complete",
    bt_complete_body: "Seeding started: {taskName}",
    ed2k_complete_title: "ED2K Download Complete",
    ed2k_complete_body: "Sharing started: {taskName}",
    download_failed_title: "Download Failed",
    download_failed_body: "{taskName}: {reason}",
    error_unknown: "Unknown error",
};

#[cfg(test)]
const SUPPORTED_LOCALES: &[&str] = &[
    "ar", "bg", "ca", "de", "el", "en-US", "es", "fa", "fr", "hu", "hi", "id", "it", "ja", "ko",
    "nb", "nl", "pl", "pt-BR", "ro", "ru", "th", "tr", "uk", "vi", "zh-CN", "zh-TW",
];

pub fn resolve_supported_locale(raw_locale: &str) -> &'static str {
    let locale = raw_locale.trim();
    if locale.is_empty() || locale == "auto" {
        return "en-US";
    }

    match locale {
        "ar" => "ar",
        "bg" => "bg",
        "ca" => "ca",
        "de" => "de",
        "el" => "el",
        "en-US" => "en-US",
        "es" => "es",
        "fa" => "fa",
        "fr" => "fr",
        "hu" => "hu",
        "hi" => "hi",
        "id" => "id",
        "it" => "it",
        "ja" => "ja",
        "ko" => "ko",
        "nb" => "nb",
        "nl" => "nl",
        "pl" => "pl",
        "pt-BR" => "pt-BR",
        "ro" => "ro",
        "ru" => "ru",
        "th" => "th",
        "tr" => "tr",
        "uk" => "uk",
        "vi" => "vi",
        "zh-CN" => "zh-CN",
        "zh-TW" => "zh-TW",
        _ if locale.starts_with("ar") => "ar",
        _ if locale.starts_with("de") => "de",
        _ if locale.starts_with("en") => "en-US",
        _ if locale.starts_with("es") => "es",
        _ if locale.starts_with("fr") => "fr",
        _ if locale.starts_with("hi") => "hi",
        _ if locale.starts_with("it") => "it",
        _ if locale.starts_with("pt") => "pt-BR",
        "zh-HK" => "zh-TW",
        _ if locale.starts_with("zh") => "zh-CN",
        _ => "en-US",
    }
}

pub fn texts_for_locale(locale: &str) -> TaskNotificationTexts {
    match resolve_supported_locale(locale) {
        "ar" => TaskNotificationTexts {
            download_start_title: "بدء التنزيل",
            download_start_body: "بدأ تنزيل \"{taskName}\"",
            download_batch_start_body: "بدأ تنزيل \"{taskName}\" و{count} مهمة أخرى",
            download_complete_title: "اكتمل التنزيل",
            download_complete_body: "تم حفظ الملف: {taskName}",
            bt_complete_title: "اكتمل تنزيل BT",
            bt_complete_body: "بدأت المشاركة: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "فشل التنزيل",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "bg" => TaskNotificationTexts {
            download_start_title: "Изтеглянето започна",
            download_start_body: "Изтеглянето на «{taskName}» започна",
            download_batch_start_body: "Изтеглянето на «{taskName}» и {count} други задачи започна",
            download_complete_title: "Изтеглянето е завършено",
            download_complete_body: "Файлът е запазен: {taskName}",
            bt_complete_title: "BT изтеглянето е завършено",
            bt_complete_body: "Споделянето започна: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Изтеглянето е неуспешно",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "ca" => TaskNotificationTexts {
            download_start_title: "Descàrrega iniciada",
            download_start_body: "S'ha iniciat la descàrrega de «{taskName}»",
            download_batch_start_body:
                "S'ha iniciat la descàrrega de «{taskName}» i {count} tasques més",
            download_complete_title: "Descàrrega completada",
            download_complete_body: "Fitxer desat: {taskName}",
            bt_complete_title: "Descàrrega BT completada",
            bt_complete_body: "S\'ha iniciat la compartició: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Descàrrega fallida",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "de" => TaskNotificationTexts {
            download_start_title: "Download gestartet",
            download_start_body: "Download von „{taskName}\" gestartet",
            download_batch_start_body:
                "Download von „{taskName}\" und {count} weiteren Aufgaben gestartet",
            download_complete_title: "Download abgeschlossen",
            download_complete_body: "Datei gespeichert: {taskName}",
            bt_complete_title: "BT-Download abgeschlossen",
            bt_complete_body: "Seeding gestartet: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Download fehlgeschlagen",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "el" => TaskNotificationTexts {
            download_start_title: "Η λήψη ξεκίνησε",
            download_start_body: "Η λήψη του \"{taskName}\" ξεκίνησε",
            download_batch_start_body:
                "Η λήψη του \"{taskName}\" και {count} ακόμα εργασιών ξεκίνησε",
            download_complete_title: "Η λήψη ολοκληρώθηκε",
            download_complete_body: "Το αρχείο αποθηκεύτηκε: {taskName}",
            bt_complete_title: "Η BT λήψη ολοκληρώθηκε",
            bt_complete_body: "Ξεκίνησε η διαμοίραση: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Η λήψη απέτυχε",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "es" => TaskNotificationTexts {
            download_start_title: "Descarga iniciada",
            download_start_body: "Descarga de \"{taskName}\" iniciada",
            download_batch_start_body: "Descarga de \"{taskName}\" y {count} tareas más iniciada",
            download_complete_title: "Descarga completada",
            download_complete_body: "Archivo guardado: {taskName}",
            bt_complete_title: "Descarga BT completada",
            bt_complete_body: "Seeding iniciado: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Descarga fallida",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "fa" => TaskNotificationTexts {
            download_start_title: "دانلود شروع شد",
            download_start_body: "دانلود \"{taskName}\" شروع شد",
            download_batch_start_body: "دانلود \"{taskName}\" و {count} وظیفه دیگر شروع شد",
            download_complete_title: "دانلود تکمیل شد",
            download_complete_body: "فایل ذخیره شد: {taskName}",
            bt_complete_title: "دانلود BT تکمیل شد",
            bt_complete_body: "اشتراک‌گذاری آغاز شد: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "دانلود ناموفق بود",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "fr" => TaskNotificationTexts {
            download_start_title: "Téléchargement démarré",
            download_start_body: "Début du téléchargement de « {taskName} »",
            download_batch_start_body:
                "Début du téléchargement de « {taskName} » et {count} autres tâches",
            download_complete_title: "Téléchargement terminé",
            download_complete_body: "Fichier enregistré : {taskName}",
            bt_complete_title: "Téléchargement BT terminé",
            bt_complete_body: "Partage démarré : {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Échec du téléchargement",
            download_failed_body: "{taskName} : {reason}",
            error_unknown: "Unknown error",
        },
        "hu" => TaskNotificationTexts {
            download_start_title: "Letöltés elindult",
            download_start_body: "\"{taskName}\" letöltése megkezdődött",
            download_batch_start_body:
                "\"{taskName}\" és {count} további feladat letöltése megkezdődött",
            download_complete_title: "Letöltés befejezve",
            download_complete_body: "Fájl mentve: {taskName}",
            bt_complete_title: "BT letöltés befejezve",
            bt_complete_body: "Megosztás elindult: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Letöltés sikertelen",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "hi" => TaskNotificationTexts {
            download_start_title: "डाउनलोड शुरू हुआ",
            download_start_body: "\"{taskName}\" डाउनलोड शुरू हुआ",
            download_batch_start_body: "\"{taskName}\" और {count} अन्य कार्य डाउनलोड होने लगे",
            download_complete_title: "डाउनलोड पूरा हुआ",
            download_complete_body: "सहेजा गया: {taskName}",
            bt_complete_title: "BT डाउनलोड पूरा हुआ",
            bt_complete_body: "Seeding शुरू हुआ: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "डाउनलोड विफल",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "अज्ञात त्रुटि",
        },
        "id" => TaskNotificationTexts {
            download_start_title: "Unduhan dimulai",
            download_start_body: "Unduhan \"{taskName}\" dimulai",
            download_batch_start_body: "Unduhan \"{taskName}\" dan {count} tugas lainnya dimulai",
            download_complete_title: "Unduhan selesai",
            download_complete_body: "File disimpan: {taskName}",
            bt_complete_title: "Unduhan BT selesai",
            bt_complete_body: "Seeding dimulai: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Unduhan gagal",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "it" => TaskNotificationTexts {
            download_start_title: "Download avviato",
            download_start_body: "Download di \"{taskName}\" avviato",
            download_batch_start_body:
                "Download di \"{taskName}\" e altre {count} attività avviato",
            download_complete_title: "Download completato",
            download_complete_body: "File salvato: {taskName}",
            bt_complete_title: "Download BT completato",
            bt_complete_body: "Condivisione avviata: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Download non riuscito",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "ja" => TaskNotificationTexts {
            download_start_title: "ダウンロード開始",
            download_start_body: "「{taskName}」 のダウンロードを開始",
            download_batch_start_body: "「{taskName}」 他 {count} 件のダウンロードを開始",
            download_complete_title: "ダウンロード完了",
            download_complete_body: "ファイルを保存しました：{taskName}",
            bt_complete_title: "BT ダウンロード完了",
            bt_complete_body: "シードを開始しました：{taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "ダウンロード失敗",
            download_failed_body: "{taskName}：{reason}",
            error_unknown: "不明なエラー",
        },
        "ko" => TaskNotificationTexts {
            download_start_title: "다운로드 시작",
            download_start_body: "\"{taskName}\" 다운로드 시작",
            download_batch_start_body: "\"{taskName}\" 외 {count}개 다운로드 시작",
            download_complete_title: "다운로드 완료",
            download_complete_body: "파일 저장됨: {taskName}",
            bt_complete_title: "BT 다운로드 완료",
            bt_complete_body: "시딩 시작됨: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "다운로드 실패",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "알 수 없는 오류",
        },
        "nb" => TaskNotificationTexts {
            download_start_title: "Nedlasting startet",
            download_start_body: "Nedlasting av \"{taskName}\" startet",
            download_batch_start_body:
                "Nedlasting av \"{taskName}\" og {count} andre oppgaver startet",
            download_complete_title: "Nedlasting fullført",
            download_complete_body: "Fil lagret: {taskName}",
            bt_complete_title: "BT-nedlasting fullført",
            bt_complete_body: "Deling startet: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Nedlasting mislyktes",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "nl" => TaskNotificationTexts {
            download_start_title: "Download gestart",
            download_start_body: "Download van \"{taskName}\" gestart",
            download_batch_start_body:
                "Download van \"{taskName}\" en {count} andere taken gestart",
            download_complete_title: "Download voltooid",
            download_complete_body: "Bestand opgeslagen: {taskName}",
            bt_complete_title: "BT-download voltooid",
            bt_complete_body: "Seeden gestart: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Download mislukt",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "pl" => TaskNotificationTexts {
            download_start_title: "Pobieranie rozpoczęte",
            download_start_body: "Rozpoczęto pobieranie \"{taskName}\"",
            download_batch_start_body:
                "Rozpoczęto pobieranie \"{taskName}\" i {count} innych zadań",
            download_complete_title: "Pobieranie ukończone",
            download_complete_body: "Plik zapisany: {taskName}",
            bt_complete_title: "Pobieranie BT ukończone",
            bt_complete_body: "Udostępnianie rozpoczęte: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Pobieranie nie powiodło się",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "pt-BR" => TaskNotificationTexts {
            download_start_title: "Download iniciado",
            download_start_body: "Download de \"{taskName}\" iniciado",
            download_batch_start_body:
                "Download de \"{taskName}\" e {count} outras tarefas iniciado",
            download_complete_title: "Download concluído",
            download_complete_body: "Arquivo salvo: {taskName}",
            bt_complete_title: "Download BT concluído",
            bt_complete_body: "Semeadura iniciada: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Download falhou",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "ro" => TaskNotificationTexts {
            download_start_title: "Descărcare începută",
            download_start_body: "Descărcarea \"{taskName}\" a început",
            download_batch_start_body:
                "Descărcarea \"{taskName}\" și a altor {count} sarcini a început",
            download_complete_title: "Descărcare finalizată",
            download_complete_body: "Fișier salvat: {taskName}",
            bt_complete_title: "Descărcare BT finalizată",
            bt_complete_body: "Distribuirea a început: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Descărcarea a eșuat",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "ru" => TaskNotificationTexts {
            download_start_title: "Загрузка начата",
            download_start_body: "Загрузка «{taskName}» начата",
            download_batch_start_body: "Загрузка «{taskName}» и ещё {count} задач начата",
            download_complete_title: "Загрузка завершена",
            download_complete_body: "Файл сохранён: {taskName}",
            bt_complete_title: "BT-загрузка завершена",
            bt_complete_body: "Раздача началась: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Загрузка не удалась",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "th" => TaskNotificationTexts {
            download_start_title: "เริ่มดาวน์โหลดแล้ว",
            download_start_body: "เริ่มดาวน์โหลด \"{taskName}\"",
            download_batch_start_body: "เริ่มดาวน์โหลด \"{taskName}\" และอีก {count} งาน",
            download_complete_title: "ดาวน์โหลดเสร็จสิ้น",
            download_complete_body: "บันทึกไฟล์แล้ว: {taskName}",
            bt_complete_title: "ดาวน์โหลด BT เสร็จสิ้น",
            bt_complete_body: "เริ่ม seeding แล้ว: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "ดาวน์โหลดไม่สำเร็จ",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "tr" => TaskNotificationTexts {
            download_start_title: "İndirme başladı",
            download_start_body: "\"{taskName}\" indirmesi başladı",
            download_batch_start_body: "\"{taskName}\" ve {count} diğer görevin indirmesi başladı",
            download_complete_title: "İndirme tamamlandı",
            download_complete_body: "Dosya kaydedildi: {taskName}",
            bt_complete_title: "BT indirmesi tamamlandı",
            bt_complete_body: "Paylaşım başladı: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "İndirme başarısız",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "uk" => TaskNotificationTexts {
            download_start_title: "Завантаження розпочато",
            download_start_body: "Завантаження «{taskName}» розпочато",
            download_batch_start_body: "Завантаження «{taskName}» та ще {count} завдань розпочато",
            download_complete_title: "Завантаження завершено",
            download_complete_body: "Файл збережено: {taskName}",
            bt_complete_title: "BT-завантаження завершено",
            bt_complete_body: "Роздачу розпочато: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Завантаження не вдалося",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "vi" => TaskNotificationTexts {
            download_start_title: "Tải xuống đã bắt đầu",
            download_start_body: "Bắt đầu tải \"{taskName}\"",
            download_batch_start_body: "Bắt đầu tải \"{taskName}\" và {count} tác vụ khác",
            download_complete_title: "Tải xuống hoàn thành",
            download_complete_body: "Đã lưu tệp: {taskName}",
            bt_complete_title: "Tải BT hoàn thành",
            bt_complete_body: "Đã bắt đầu seeding: {taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "Tải xuống thất bại",
            download_failed_body: "{taskName}: {reason}",
            error_unknown: "Unknown error",
        },
        "zh-CN" => TaskNotificationTexts {
            download_start_title: "下载已开始",
            download_start_body: "开始下载「{taskName}」",
            download_batch_start_body: "开始下载「{taskName}」等 {count} 个任务",
            download_complete_title: "下载完成",
            download_complete_body: "文件已保存：{taskName}",
            bt_complete_title: "BT 下载完成",
            bt_complete_body: "已开始做种：{taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "下载失败",
            download_failed_body: "{taskName}：{reason}",
            error_unknown: "未知错误",
        },
        "zh-TW" => TaskNotificationTexts {
            download_start_title: "下載已開始",
            download_start_body: "開始下載「{taskName}」",
            download_batch_start_body: "開始下載「{taskName}」等 {count} 個任務",
            download_complete_title: "下載完成",
            download_complete_body: "檔案已儲存：{taskName}",
            bt_complete_title: "BT 下載完成",
            bt_complete_body: "已開始做種：{taskName}",
            ed2k_complete_title: "ED2K Download Complete",
            ed2k_complete_body: "Sharing started: {taskName}",
            download_failed_title: "下載失敗",
            download_failed_body: "{taskName}：{reason}",
            error_unknown: "未知錯誤",
        },
        _ => EN_US_TEXTS,
    }
}

pub fn format_task_message(template: &str, task_name: &str) -> String {
    template.replace("{taskName}", task_name)
}

pub fn format_error_message(template: &str, task_name: &str, reason: &str) -> String {
    template
        .replace("{taskName}", task_name)
        .replace("{reason}", reason)
}

pub fn format_batch_task_message(template: &str, task_name: &str, count: usize) -> String {
    template
        .replace("{taskName}", task_name)
        .replace("{count}", &count.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_explicit_supported_locale() {
        assert_eq!(resolve_supported_locale("zh-CN"), "zh-CN");
    }

    #[test]
    fn resolves_language_prefix_locale() {
        assert_eq!(resolve_supported_locale("zh-Hans-CN"), "zh-CN");
        assert_eq!(resolve_supported_locale("en-AU"), "en-US");
        assert_eq!(resolve_supported_locale("pt-PT"), "pt-BR");
        assert_eq!(resolve_supported_locale("hi-IN"), "hi");
    }

    #[test]
    fn falls_back_to_en_us_for_auto_or_unknown_locale() {
        assert_eq!(resolve_supported_locale("auto"), "en-US");
        assert_eq!(resolve_supported_locale("xx-YY"), "en-US");
    }

    #[test]
    fn all_supported_locales_have_notification_texts() {
        assert_eq!(SUPPORTED_LOCALES.len(), 27);
        for locale in SUPPORTED_LOCALES {
            let texts = texts_for_locale(locale);
            assert!(
                !texts.download_start_title.is_empty(),
                "empty start title for {locale}"
            );
            assert!(
                texts.download_start_body.contains("{taskName}"),
                "start body lacks placeholder for {locale}"
            );
            assert!(
                texts.download_batch_start_body.contains("{taskName}"),
                "batch start body lacks task placeholder for {locale}"
            );
            assert!(
                texts.download_batch_start_body.contains("{count}"),
                "batch start body lacks count placeholder for {locale}"
            );
            assert!(
                !texts.download_complete_title.is_empty(),
                "empty complete title for {locale}"
            );
            assert!(
                texts.download_complete_body.contains("{taskName}"),
                "complete body lacks placeholder for {locale}"
            );
            assert!(
                !texts.bt_complete_title.is_empty(),
                "empty BT title for {locale}"
            );
            assert!(
                texts.bt_complete_body.contains("{taskName}"),
                "BT body lacks placeholder for {locale}"
            );
            assert!(
                !texts.download_failed_title.is_empty(),
                "empty failed title for {locale}"
            );
            assert!(
                texts.download_failed_body.contains("{taskName}"),
                "failed body lacks placeholder for {locale}"
            );
            assert!(
                texts.download_failed_body.contains("{reason}"),
                "failed body lacks reason placeholder for {locale}"
            );
            assert!(
                !texts.error_unknown.is_empty(),
                "empty unknown error for {locale}"
            );
        }
    }

    #[test]
    fn localises_download_complete_texts() {
        let texts = texts_for_locale("en-US");
        assert_eq!(texts.download_complete_title, "Download Complete");
        assert_eq!(
            format_task_message(texts.download_complete_body, "file.zip"),
            "Saved: file.zip"
        );
    }

    #[test]
    fn localises_download_start_texts() {
        let texts = texts_for_locale("en-US");
        assert_eq!(texts.download_start_title, "Download Started");
        assert_eq!(
            format_task_message(texts.download_start_body, "file.zip"),
            "Started downloading \"file.zip\""
        );
        assert_eq!(
            format_batch_task_message(texts.download_batch_start_body, "file.zip", 2),
            "Started downloading \"file.zip\" and 2 other task(s)"
        );
    }

    #[test]
    fn localises_bt_complete_texts() {
        let texts = texts_for_locale("en-US");
        assert_eq!(texts.bt_complete_title, "BT Download Complete");
        assert_eq!(
            format_task_message(texts.bt_complete_body, "file.zip"),
            "Seeding started: file.zip"
        );
    }

    #[test]
    fn localises_error_texts() {
        let texts = texts_for_locale("en-US");
        assert_eq!(
            format_error_message(texts.download_failed_body, "file.zip", "Network error"),
            "file.zip: Network error"
        );
    }
}

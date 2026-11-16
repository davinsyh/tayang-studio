import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { creatorInfo, type CreatorInfo } from "@/lib/hybrid";
export function TikTokOptions({
  accountId,
  contentKey = "",
  onChange,
}: {
  accountId: string;
  contentKey?: string;
  onChange(v: Record<string, unknown> | undefined): void;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<CreatorInfo | null>(null);
  const [error, setError] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    allow_comment: false,
    allow_duet: false,
    allow_stitch: false,
  });
  useEffect(() => { setConfirmed(false); }, [contentKey]);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setPrivacy("");
    setConfirmed(false);
    setError("");
    creatorInfo(accountId)
      .then((v) => alive && setInfo(v))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [accountId]);
  useEffect(() => {
    onChange(
      confirmed && privacy
        ? {
            privacy_level: privacy,
            ...toggles,
            content_preview_confirmed: true,
            express_consent_given: true,
          }
        : undefined,
    );
  }, [confirmed, privacy, toggles, onChange]);
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <legend>TikTok</legend>
      {error ? (
        <p role="alert">{error}</p>
      ) : !info ? (
        <p role="status">{t("hybrid.checking")}</p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            {t("hybrid.privacy")}
            <select
              className="rounded border border-border bg-card p-2"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
            >
              <option value="">{t("hybrid.choosePrivacy")}</option>
              {info.privacyLevels.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {Object.keys(toggles).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!info.postingLimits?.interactionSettings[k]?.enabled}
                checked={toggles[k]}
                onChange={(e) =>
                  setToggles((v) => ({ ...v, [k]: e.target.checked }))
                }
              />
              {
                (
                  {
                    allow_comment: t("hybrid.comments"),
                    allow_duet: t("hybrid.duet"),
                    allow_stitch: t("hybrid.stitch"),
                  } as Record<string, string>
                )[k]
              }
            </label>
          ))}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t("hybrid.consent")}
          </label>
        </>
      )}
    </fieldset>
  );
}

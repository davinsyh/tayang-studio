import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/Button";
import { Input } from "@/components/ui/input";
import { hybridSave, useHybrid, youtubeConnect } from "@/lib/hybrid";

export function HybridSettingsPanel() {
  const { t } = useTranslation();
  const settings = useHybrid((s) => s.settings);
  const [enabled, setEnabled] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [clientId, setClientId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void useHybrid.getState().refresh();
  }, []);
  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setProfileId(settings.profileId);
      setClientId(settings.clientId);
    }
  }, [settings]);
  const save = async () => {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await hybridSave({
        enabled,
        profileId: profileId.trim(),
        clientId: clientId.trim(),
        apiKey: apiKey || undefined,
        clientSecret: clientSecret || undefined,
      });
      setApiKey("");
      setClientSecret("");
      await useHybrid.getState().refresh();
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      await youtubeConnect();
      await useHybrid.getState().refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex max-w-3xl flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <h2 className="m-0 text-base font-medium">{t("hybrid.title")}</h2>
      <p className="m-0 text-sm text-text-2">{t("hybrid.description")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
          disabled={busy}
        />
        {t("hybrid.enabled")}
      </label>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          {t("hybrid.zernioKey")}
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.hasZernioKey ? t("hybrid.savedKey") : ""}
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("hybrid.profileId")}
          <Input
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("hybrid.clientId")}
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("hybrid.clientSecret")}
          <Input
            type="password"
            autoComplete="off"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={t("hybrid.keepSecret")}
            disabled={busy}
          />
        </label>
      </div>
      <p className="m-0 text-xs text-text-3">{t("hybrid.setupHint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? t("hybrid.working") : t("hybrid.save")}
        </Button>
        <Button
          variant="secondary"
          disabled={
            busy || !settings?.clientId || settings.clientId !== clientId.trim()
          }
          onClick={() => void connect()}
        >
          {t("hybrid.connectYoutube")}
        </Button>
        {settings?.youtubeConnected && (
          <span className="text-sm text-text-2">
            YouTube: {settings.youtubeName}
          </span>
        )}
      </div>
      {busy && (
        <p role="status" className="m-0 text-sm text-text-2">
          {t("hybrid.browserHint")}
        </p>
      )}
      {saved && (
        <p role="status" className="m-0 text-sm">
          {t("hybrid.saved")}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-sm text-orange-light">
          {error}
        </p>
      )}
    </section>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import { api } from '../api';
import type { SiteSettings } from '../types';
import {
  chapterBackgroundGroups,
  resolveChapterBackground,
  type ChapterBackgroundGroup,
} from '../features/chapter-backgrounds';
import { UploadField } from './UploadField';

export function AdminBackgrounds({
  settings,
  onSaved,
  onError,
  canUpload,
}: {
  settings: SiteSettings;
  onSaved: (settings: SiteSettings) => void;
  onError: (message: string) => void;
  canUpload: boolean;
}) {
  const [form, setForm] = useState(settings);
  const [activeGroup, setActiveGroup] = useState<ChapterBackgroundGroup>('activities');
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [uploads, setUploads] = useState(0);
  useEffect(() => {
    setForm(settings);
    setDirty(false);
  }, [settings]);

  function update(group: ChapterBackgroundGroup, chapterId: string, value: string) {
    setDirty(true);
    setForm((current) => ({
      ...current,
      chapterBackgrounds: {
        ...current.chapterBackgrounds,
        [group]: { ...current.chapterBackgrounds?.[group], [chapterId]: value },
      },
    }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || uploads) return;
    setSaving(true);
    try {
      const result = await api<{ settings: SiteSettings }>('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setForm(result.settings);
      setDirty(false);
      onSaved(result.settings);
    } catch (error) {
      onError(error instanceof Error ? error.message : '背景保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-panel admin-backgrounds">
      <div className="admin-toolbar">
        <div>
          <h2>页面板块背景</h2>
          <p className="admin-help">
            按前台顺序管理每个板块的背景图片。上传或填写图片地址后，点击“保存背景”生效。
          </p>
        </div>
      </div>
      <form className="admin-form" data-dirty={dirty} onSubmit={submit}>
        <fieldset className="admin-background-fieldset" disabled={saving}>
          <div className="admin-background-groups" role="group" aria-label="选择背景栏目">
            {chapterBackgroundGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                className="admin-button admin-secondary"
                aria-pressed={activeGroup === group.id}
                onClick={() => setActiveGroup(group.id)}
              >
                {group.title}
                <span>{group.chapters.length} 个板块</span>
              </button>
            ))}
          </div>
          {chapterBackgroundGroups.map((group) => (
            <section
              key={group.id}
              hidden={activeGroup !== group.id}
              aria-labelledby={`backgrounds-${group.id}`}
            >
              <div className="admin-background-heading">
                <h3 id={`backgrounds-${group.id}`}>{group.title}</h3>
                <p className="admin-help">
                  预览显示当前选择的图片。恢复默认后，该板块使用原有默认素材。
                </p>
              </div>
              <div className="admin-background-list">
                {group.chapters.map((chapter) => {
                  const value = form.chapterBackgrounds?.[group.id]?.[chapter.id] ?? '';
                  const preview = resolveChapterBackground(form, group.id, chapter.id);
                  const href = `${group.id === 'about' ? '/about' : '/'}#${chapter.id}`;
                  return (
                    <div key={chapter.id} className="admin-background-row">
                      <figure className="admin-background-preview">
                        <img src={preview} alt={`${chapter.title}背景预览`} loading="lazy" />
                        <figcaption>{value.trim() ? '自定义背景' : '默认背景'}</figcaption>
                      </figure>
                      <div className="admin-background-editor">
                        <div className="admin-background-row-heading">
                          <h3>{chapter.title}</h3>
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            查看板块
                            <ArrowUpRight size={15} />
                          </a>
                        </div>
                        <UploadField
                          label={`${chapter.title}背景地址`}
                          value={value}
                          showPreview={false}
                          canUpload={canUpload}
                          onChange={(url) => update(group.id, chapter.id, url)}
                          onError={onError}
                          onBusy={(busy) => {
                            if (busy) setDirty(true);
                            setUploads((count) => count + (busy ? 1 : -1));
                          }}
                        />
                        <button
                          type="button"
                          className="admin-button admin-secondary admin-background-reset"
                          disabled={!value.trim() || uploads > 0}
                          onClick={() => update(group.id, chapter.id, '')}
                        >
                          <RotateCcw size={15} />
                          恢复默认
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </fieldset>
        <div className="admin-toolbar admin-background-save">
          <button
            className="admin-button admin-primary"
            type="submit"
            disabled={saving || uploads > 0 || !dirty}
          >
            {saving ? '保存中…' : uploads ? '等待图片上传…' : '保存背景'}
          </button>
          <span className="admin-help">
            {dirty ? '有未保存的背景修改' : '背景设置已与网站同步'}
          </span>
        </div>
      </form>
    </section>
  );
}

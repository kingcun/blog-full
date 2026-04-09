import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { Button } from "../components/button";
import { useAlert } from "../components/dialog";
import { client } from "../app/runtime";
import { useSiteConfig } from "../hooks/useSiteConfig";

interface Article {
  id: number;
  title: string;
  createdAt: string;
  listed: boolean;
  draft: boolean;
}

export function ManageArticlesPage() {
  const siteConfig = useSiteConfig();
  const [articles, setArticles] = useState<Article[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const { showAlert, AlertUI } = useAlert();

  useEffect(() => {
    fetchArticles();
  }, []);

  async function fetchArticles() {
    setLoading(true);
    try {
      // API trả về { size, data: [...] }
      const res = await client.post.list({ limit: 100 });
      // Map lại để đảm bảo có đủ các trường Article (listed, draft là boolean)
      const raw = Array.isArray(res.data?.data) ? res.data.data : [];
      setArticles(
        raw.map((a: any) => ({
          id: a.id,
          title: a.title,
          createdAt: a.createdAt,
          listed: !!a.listed,
          draft: !!a.draft,
        }))
      );
    } catch (e) {
      showAlert("Failed to load articles");
    } finally {
      setLoading(false);
    }
  }

  const toggle = (id: number) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const toggleAll = () => {
    setSelected(selected.size === articles.length ? new Set() : new Set(articles.map((a) => a.id)));
  };

  const deleteSelected = async () => {
    if (!selected.size) { showAlert("Please select articles to delete"); return; }
    if (!window.confirm("Are you sure you want to delete selected articles?")) return;
    setLoading(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try {
        const { error } = await client.post.delete(id);
        error ? fail++ : ok++;
      } catch { fail++; }
    }
    showAlert(`Done: ${ok} deleted, ${fail} failed`);
    setSelected(new Set());
    fetchArticles();
    setLoading(false);
  };

  return (
    <>
      <Helmet><title>{`Manage Articles - ${siteConfig.name}`}</title></Helmet>
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <Button title={selected.size === articles.length ? "Deselect All" : "Select All"} onClick={toggleAll} />
          <Button title={loading ? "Deleting..." : `Delete Selected (${selected.size})`} disabled={loading || selected.size === 0} onClick={deleteSelected} />
        </div>
        <div className="border rounded-lg divide-y">
          {articles.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-3">
              <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.title}</div>
                <div className="text-xs text-neutral-500">{new Date(a.createdAt).toLocaleString()}</div>
              </div>
              {a.draft && <span className="text-xs px-2 py-0.5 bg-yellow-100 rounded">Draft</span>}
              {!a.listed && <span className="text-xs px-2 py-0.5 bg-gray-200 rounded">Unlisted</span>}
            </div>
          ))}
        </div>
      </div>
      <AlertUI />
    </>
  );
}

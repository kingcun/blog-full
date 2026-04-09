import { useContext, useEffect, useRef } from "react";
import { ProfileContext } from "../state/profile";
import { Padding } from "./padding";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { getHeaderLayoutDefinition } from "./site-header/layout-registry";
import { normalizeHeaderBehavior, normalizeHeaderLayout } from "./site-header/layout-options";

export function Header({ children }: { children?: React.ReactNode }) {
  const profile = useContext(ProfileContext);
  const siteConfig = useSiteConfig();
  const headerLayout = normalizeHeaderLayout(siteConfig.headerLayout);
  const headerBehavior = normalizeHeaderBehavior(siteConfig.headerBehavior);
  const layoutDefinition = getHeaderLayoutDefinition(headerLayout);
  
  // Đã xóa isRevealed và isAtTop vì không dùng đến
  const headerRef = useRef<HTMLDivElement | null>(null);

  // Giữ lại useEffect này để tính toán header-scroll-offset cho các thành phần khác (nếu cần)
  useEffect(() => {
    const root = document.documentElement;
    const setHeaderScrollOffset = () => {
      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
      root.style.setProperty("--header-scroll-offset", `${Math.ceil(headerHeight + 16)}px`);
    };

    setHeaderScrollOffset();

    const resizeObserver = new ResizeObserver(() => {
      setHeaderScrollOffset();
    });

    if (headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    window.addEventListener("resize", setHeaderScrollOffset);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", setHeaderScrollOffset);
    };
  }, [headerBehavior, headerLayout]);

  // Codelist-like header: flat, bordered, compact height.
  const containerClassName =
    "relative z-40 w-full border-b border-neutral-200 bg-white dark:border-none dark:bg-[#2c2e32]";

  return (
    <>
      <div ref={headerRef} className={containerClassName}>
        <div className="mx-auto w-full bg-[#2c2e32]">
          {headerLayout === "compact" ? (
            <div className="w-full px-4">
              {layoutDefinition.renderMobile({ children, profile, siteConfig, behavior: headerBehavior, isAtTop: true })}
              {layoutDefinition.renderDesktop({ children, profile, siteConfig, behavior: headerBehavior, isAtTop: true })}
            </div>
          ) : (
            <Padding className="mx-0">
              <div className="w-full px-4">
                {layoutDefinition.renderMobile({ children, profile, siteConfig, behavior: headerBehavior, isAtTop: true })}
                {layoutDefinition.renderDesktop({ children, profile, siteConfig, behavior: headerBehavior, isAtTop: true })}
              </div>
            </Padding>
          )}
        </div>
      </div>
      {/* Spacer h-0 vì không còn fixed/sticky */}
      <div className="h-0" />
    </>
  );
}
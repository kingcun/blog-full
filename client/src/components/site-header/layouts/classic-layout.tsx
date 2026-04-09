import { BrandLink, HeaderActions, Menu, NavBar } from "..";
import { PreviewActions, PreviewBrand, PreviewCanvas, PreviewContent, PreviewNav } from "../preview-primitives";
import type { HeaderLayoutDefinition } from "../layout-types";

const PREVIEW_ITEMS = ["Home", "Timeline", "Moments"];

export const classicLayoutDefinition: HeaderLayoutDefinition = {
  kind: "top",
  renderDesktop({ children, profile, siteConfig }) {
    return (
      <div className="hidden h-[42px] w-full items-center justify-between md:flex">
        <BrandLink
          siteConfig={siteConfig}
          showAvatar={false}
          showDescription={false}
          className="mr-8 hidden flex-row items-center md:flex"
          titleClassName="text-[13px] tracking-tight text-white dark:text-white"
        />
        <div className="flex min-w-0 flex-1 items-center">
          <div className="scrollbar-none min-w-0 max-w-full overflow-x-auto">
            <div className="flex min-w-max flex-row items-center whitespace-nowrap">
              <NavBar
                menu={false}
                itemClassName="whitespace-nowrap px-2 py-2 text-[12px] uppercase tracking-[0.14em] text-white hover:text-white dark:text-neutral-200 dark:hover:text-white"
              />
            </div>
          </div>
        </div>
        <div className="ml-8 hidden flex-row items-center space-x-2 md:flex">
          {children ? <div className="flex items-center text-sm t-primary">{children}</div> : null}
          <HeaderActions profile={profile} plain className="flex flex-row items-center space-x-1" />
        </div>
      </div>
    );
  },
  renderMobile({ children, profile, siteConfig }) {
    return (
      <div className="flex h-16 w-full flex-row items-center justify-center md:hidden">
        <div className="w-full flex-row items-center justify-center transition-all duration-500">
          {/* FIX: Bỏ rounded-full, bg-w và shadow trên Mobile */}
          <div className="flex flex-row items-center t-primary w-full">
            <BrandLink
              siteConfig={siteConfig}
              compact
              showAvatar={false}
              showDescription={false}
              className="visible mr-auto flex flex-row items-center py-2 opacity-100 duration-300 md:hidden"
              titleClassName="text-[18px] font-extrabold tracking-tight text-white dark:text-white"
            />
            <NavBar menu={false} />
            <div className="ml-auto flex items-center gap-1">
              {children ? <div className="flex items-center text-sm t-primary">{children}</div> : null}
              <Menu profile={profile} />
            </div>
          </div>
        </div>
      </div>
    );
  },
  renderPreview(data) {
    return (
      <PreviewCanvas className="w-full overflow-hidden rounded-[22px] p-3">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <PreviewBrand data={data} />
          <div className="mx-2 flex min-w-0 items-center justify-center">
            <div className="max-w-full rounded-full bg-white px-2 py-2 shadow-lg shadow-black/5 ring-1 ring-black/5 dark:bg-white/[0.08] dark:shadow-black/20 dark:ring-white/10">
              <PreviewNav center items={PREVIEW_ITEMS} themeColor={data.themeColor} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-black/[0.04] dark:bg-white/[0.08]" />
            <PreviewActions themeColor={data.themeColor} />
          </div>
        </div>
        <PreviewContent />
      </PreviewCanvas>
    );
  },
  renderRouteShell({ header, content, footer }) {
    return (
      <div className="flex flex-col min-h-screen max-w-[1200px] mx-auto shadow-[0_1px_7px_rgba(171,171,171,0.5)] dark:shadow-[0_1px_10px_rgba(0,0,0,0.5)]">
        {header}
        <main className="flex-1 bg-white py-4 px-1.5 dark:bg-[#27292d]">
          {content}
        </main>
        {footer}
      </div>
    );
  },
};
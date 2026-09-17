import { ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface Crumb {
  label: string;
  /** Omitted on the last crumb — the page you are already on is not a link. */
  href?: string;
}

/**
 * Where you are, and the way back up.
 *
 * The last crumb carries `aria-current="page"` and is deliberately not a link:
 * a link to the page you are on is a promise the interface cannot keep.
 * Separators are `aria-hidden` so a screen reader reads the trail rather than
 * a row of chevrons.
 */
export function Breadcrumbs({
  crumbs,
  linkAs: Link = 'a',
  className,
}: {
  crumbs: readonly Crumb[];
  /** The router's link component, so navigation stays client-side. */
  linkAs?: React.ElementType;
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-xs', className)}>
      <ol className="flex items-center gap-1">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${String(index)}`}>
              <li>
                {last || !crumb.href ? (
                  <span aria-current={last ? 'page' : undefined} className="text-ink">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="text-ink-secondary hover:text-ink hover:underline"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
              {last ? null : (
                <li aria-hidden="true" className="text-ink-muted">
                  <ChevronRight className="size-3" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/** A page heading with its crumbs and whatever actions belong to the page. */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  linkAs,
  className,
}: {
  title: string;
  description?: string;
  crumbs?: readonly Crumb[];
  actions?: ReactNode;
  linkAs?: React.ElementType;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-2', className)}>
      {crumbs && crumbs.length > 0 ? (
        <Breadcrumbs crumbs={crumbs} {...(linkAs ? { linkAs } : {})} />
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {description ? <p className="text-sm text-ink-secondary">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

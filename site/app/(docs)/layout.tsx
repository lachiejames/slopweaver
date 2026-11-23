import { Footer, Layout, Navbar } from "nextra-theme-docs";
import "nextra-theme-docs/style.css";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import type { ReactElement, ReactNode } from "react";
import { SlopweaverMark } from "../../components/SlopweaverMark";
import "../diagram.css";

export const metadata = {
  title: { absolute: "Docs · Slopweaver", template: "%s · Slopweaver docs" },
  description: "How the bot turns a Slack tag into a sourced answer.",
};

const navbar = (
  <Navbar
    logoLink="/"
    logo={
      <span className="sw-logo">
        <SlopweaverMark />
        Slopweaver
      </span>
    }
  />
);

const footer = <Footer>Internal. Rendered on this machine; this site is never published.</Footer>;

/**
 * The document shell every page renders inside.
 *
 * The edit link and the feedback link are off on purpose: there is no hosted copy of this site to edit
 * against, and a link that 404s is worse than no link.
 *
 * @param children the docs page
 * @returns the document, with Nextra's navbar, sidebar and footer around the page
 */
export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactElement> {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head color={{ hue: 262, saturation: 83 }} />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap("/docs")}
          editLink={null}
          feedback={{ content: null }}
          sidebar={{ defaultMenuCollapseLevel: 2 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}

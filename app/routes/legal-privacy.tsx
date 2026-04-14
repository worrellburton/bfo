import { useTheme } from "../theme";

export function meta() {
  return [{ title: "BFO - Privacy Policy" }];
}

export default function PrivacyPolicy() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const bodyColor = isDark ? "#e5e7eb" : "#222";
  const mutedColor = isDark ? "#9ca3af" : "#666";
  const footerColor = isDark ? "#6b7280" : "#999";
  const borderColor = isDark ? "#1f2937" : "#e5e5e5";
  const bgColor = isDark ? "#0a0a0a" : "#ffffff";

  return (
    <div style={{ background: bgColor, minHeight: "100vh" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, sans-serif", color: bodyColor }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
        <p style={{ color: mutedColor, fontSize: 14, marginBottom: 32 }}>Last updated: March 31, 2026</p>

        <p style={{ fontSize: 15, lineHeight: 1.7, marginBottom: 20 }}>
          BFO Finance (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed to protecting the privacy of our users. This Privacy Policy describes how we collect, use, and safeguard your information when you use our application.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>1. Information We Collect</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          <strong>Account Information:</strong> When you use BFO Finance, we may collect your name, email address, and login credentials for authentication purposes.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          <strong>Financial Data:</strong> When you connect third-party services (such as QuickBooks Online), we access financial data including but not limited to: income statements, balance sheets, invoices, expenses, and transaction history. This data is accessed via secure API connections using OAuth 2.0 authorization.
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          <strong>Usage Data:</strong> We may collect information about how you interact with the Service, including pages viewed and features used.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>2. How We Use Your Information</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          We use the information we collect to:
        </p>
        <ul style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16, paddingLeft: 24 }}>
          <li>Provide financial analytics, dashboards, and reporting</li>
          <li>Display your QuickBooks data within the BFO Finance platform</li>
          <li>Maintain and improve the Service</li>
          <li>Ensure the security of your account</li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>3. Data Sharing</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          We do not sell, rent, or share your personal or financial data with third parties. Your data is used solely within the BFO Finance platform for your benefit. We may share information only in the following circumstances:
        </p>
        <ul style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16, paddingLeft: 24 }}>
          <li>With your explicit consent</li>
          <li>To comply with legal obligations or valid legal processes</li>
          <li>To protect the rights, property, or safety of BFO Finance or its users</li>
        </ul>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>4. Data Security</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          We implement industry-standard security measures to protect your data. Third-party integrations use OAuth 2.0 for authorization — we never store your QuickBooks username or password. Access tokens are stored securely and refreshed automatically.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>5. Data Retention</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          We retain your data only for as long as necessary to provide the Service. Financial data from third-party integrations is accessed in real-time and is not permanently stored on our servers beyond what is necessary for caching and performance.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>6. Third-Party Services</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          BFO Finance integrates with third-party services including Intuit QuickBooks Online. These services have their own privacy policies that govern their collection and use of your data. We encourage you to review the privacy policies of any third-party services you connect.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>7. Your Rights</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          You may disconnect any third-party integration at any time, which will revoke our access to that service&rsquo;s data. You may request deletion of your account and associated data by contacting the Burton Family Office.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>8. Changes to This Policy</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          We may update this Privacy Policy from time to time. We will notify you of any material changes by posting the updated policy within the application. Your continued use of the Service constitutes acceptance of the revised policy.
        </p>

        <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32, marginBottom: 12 }}>9. Contact</h2>
        <p style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16 }}>
          For questions about this Privacy Policy or your data, please contact the Burton Family Office.
        </p>

        <div style={{ marginTop: 48, paddingTop: 24, borderTop: `1px solid ${borderColor}`, fontSize: 12, color: footerColor }}>
          BFO Finance &mdash; Burton Family Office
        </div>
      </div>
    </div>
  );
}

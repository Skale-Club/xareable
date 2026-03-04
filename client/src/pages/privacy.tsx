import { LegalDocument } from "@/components/legal-document";
import { useAppName } from "@/lib/app-settings";

export default function PrivacyPage() {
  const appName = useAppName();
  const serviceName = appName || "our service";

  return (
    <LegalDocument
      title="Privacy Policy"
      summary={`This Privacy Policy explains what information we collect, how we use it, and the choices you have when you use ${serviceName}.`}
      path="/privacy"
      sections={[
        {
          title: "Information We Collect",
          content: (
            <>
              <p>
                We collect the information you provide directly to create and manage
                your account, including your email address, brand settings, uploaded
                assets, prompts, and any content you generate or save inside the
                platform.
              </p>
              <p>
                If you purchase paid features, billing and payment information is
                handled by our payment providers. We may receive transaction
                confirmations, billing status, and limited account details, but we do
                not store full payment card information on our own servers.
              </p>
              <p>
                We also collect technical data needed to operate the platform, such
                as log data, browser details, device information, authentication
                events, and usage activity tied to generation, editing, or storage
                actions.
              </p>
            </>
          ),
        },
        {
          title: "How We Use Your Information",
          content: (
            <>
              <p>
                We use your information to provide the core product experience,
                including account access, post generation, brand personalization,
                file storage, credit tracking, billing, and customer support.
              </p>
              <p>
                Information may also be used to maintain security, detect abuse,
                troubleshoot service issues, improve reliability, and comply with
                legal obligations.
              </p>
            </>
          ),
        },
        {
          title: "AI Processing and Service Providers",
          content: (
            <>
              <p>
                To generate content, we may send prompts, uploaded reference
                materials, brand context, and related instructions to third-party AI
                providers that process requests on our behalf. We also rely on
                third-party providers for authentication, database storage, file
                hosting, and payments.
              </p>
              <p>
                We share information with those providers only as reasonably
                necessary to deliver the service, process transactions, secure the
                platform, or comply with law.
              </p>
            </>
          ),
        },
        {
          title: "How We Share Information",
          content: (
            <>
              <p>
                We do not share your personal information with unrelated third
                parties for their own independent marketing use. We may disclose
                information when required by law, to enforce our terms, to protect the
                rights or safety of users or the public, or in connection with a
                merger, financing, or sale of business assets.
              </p>
            </>
          ),
        },
        {
          title: "Data Retention",
          content: (
            <>
              <p>
                We retain account data, generated assets, and related records for as
                long as needed to operate your account, satisfy legal and accounting
                requirements, resolve disputes, and enforce agreements. If you close
                your account, we may delete or anonymize data within a reasonable
                period unless retention is required by law or for legitimate security
                purposes.
              </p>
            </>
          ),
        },
        {
          title: "Security",
          content: (
            <>
              <p>
                We use reasonable administrative, technical, and organizational
                safeguards designed to protect your information. No method of storage
                or transmission is completely secure, so we cannot guarantee absolute
                security.
              </p>
            </>
          ),
        },
        {
          title: "Your Choices",
          content: (
            <>
              <p>
                You can review and update certain account and brand information from
                within the product. You may also stop using the service at any time.
                If you need account deletion or have a privacy request, contact us
                using the contact method provided on this website.
              </p>
            </>
          ),
        },
        {
          title: "Children's Privacy",
          content: (
            <>
              <p>
                The service is not directed to children under 13, and we do not
                knowingly collect personal information from children under 13. If we
                learn that such information has been collected, we will take
                reasonable steps to delete it.
              </p>
            </>
          ),
        },
        {
          title: "Changes to This Policy",
          content: (
            <>
              <p>
                We may update this Privacy Policy from time to time. When we make
                material changes, we may update the effective date above and, when
                appropriate, provide additional notice through the service.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

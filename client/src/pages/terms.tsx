import { LegalDocument } from "@/components/legal-document";
import { useAppName } from "@/lib/app-settings";

export default function TermsPage() {
  const appName = useAppName();
  const serviceName = appName || "the service";

  return (
    <LegalDocument
      title="Terms of Service"
      summary={`These Terms of Service govern your access to and use of ${serviceName}. By using the platform, you agree to these terms.`}
      path="/terms"
      sections={[
        {
          title: "Use of the Service",
          content: (
            <>
              <p>
                You may use the service only in compliance with these terms and all
                applicable laws. You are responsible for your account, your prompts,
                your uploads, and any content you publish or distribute using the
                platform.
              </p>
            </>
          ),
        },
        {
          title: "Accounts and Eligibility",
          content: (
            <>
              <p>
                You must provide accurate information when creating an account and
                keep your login credentials secure. You are responsible for all
                activity that occurs under your account unless the activity results
                from our own failure to maintain reasonable security controls.
              </p>
            </>
          ),
        },
        {
          title: "Acceptable Use",
          content: (
            <>
              <p>You may not use the service to:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Violate any law or regulation.</li>
                <li>Upload or generate content that infringes intellectual property, privacy, or publicity rights.</li>
                <li>Transmit malware, abusive code, or attempt unauthorized access to systems or accounts.</li>
                <li>Abuse automated systems, bypass usage limits, or interfere with the normal operation of the platform.</li>
                <li>Create unlawful, fraudulent, defamatory, harassing, or deceptive content.</li>
              </ul>
            </>
          ),
        },
        {
          title: "AI-Generated Output",
          content: (
            <>
              <p>
                The platform uses third-party AI systems to help generate text and
                images. AI output may be inaccurate, incomplete, biased, or similar
                to content generated for other users. You are responsible for
                reviewing all output before using it commercially, publicly, or in a
                regulated context.
              </p>
              <p>
                We do not guarantee that generated output will be unique, available,
                error-free, or suitable for any particular purpose.
              </p>
            </>
          ),
        },
        {
          title: "Fees, Credits, and Payments",
          content: (
            <>
              <p>
                Paid features, subscriptions, or credits may be offered through the
                platform. If you purchase paid services, you agree to pay the fees
                presented at checkout, plus any applicable taxes. Unless otherwise
                stated, purchases are non-refundable except where required by law.
              </p>
              <p>
                We may change pricing, credit policies, or available features in the
                future. Any change will apply prospectively and will not alter charges
                already incurred.
              </p>
            </>
          ),
        },
        {
          title: "Ownership and Rights",
          content: (
            <>
              <p>
                You retain ownership of the content and materials you submit to the
                service. Subject to applicable law and third-party provider terms, you
                may use the generated output created for your account.
              </p>
              <p>
                We retain all rights in the software, design, branding, and platform
                infrastructure. These terms do not transfer ownership of our
                technology or intellectual property to you.
              </p>
            </>
          ),
        },
        {
          title: "Availability and Changes",
          content: (
            <>
              <p>
                We may modify, suspend, or discontinue any part of the service at any
                time, including features, integrations, pricing, or technical limits.
                We will use reasonable efforts to avoid unnecessary disruption, but we
                do not guarantee uninterrupted availability.
              </p>
            </>
          ),
        },
        {
          title: "Disclaimers",
          content: (
            <>
              <p>
                The service is provided on an "as is" and "as available" basis. To
                the fullest extent permitted by law, we disclaim all warranties,
                express or implied, including warranties of merchantability, fitness
                for a particular purpose, non-infringement, and uninterrupted service.
              </p>
            </>
          ),
        },
        {
          title: "Limitation of Liability",
          content: (
            <>
              <p>
                To the fullest extent permitted by law, we will not be liable for any
                indirect, incidental, special, consequential, exemplary, or punitive
                damages, or for any loss of profits, revenues, data, goodwill, or
                business opportunities arising from or related to your use of the
                service.
              </p>
            </>
          ),
        },
        {
          title: "Suspension and Termination",
          content: (
            <>
              <p>
                We may suspend or terminate access to the service if we believe you
                have violated these terms, created legal or security risk, failed to
                pay fees when due, or used the platform in a way that could harm the
                service or other users.
              </p>
            </>
          ),
        },
        {
          title: "Changes to These Terms",
          content: (
            <>
              <p>
                We may revise these terms from time to time. Updated terms become
                effective when posted unless a later date is stated. Continued use of
                the service after updated terms take effect means you accept the
                revised terms.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

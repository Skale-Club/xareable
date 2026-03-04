const fs = require('fs');
const file = 'c:/Users/Vanildo/Dev/xareable/client/src/components/admin/landing-page-tab.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add uploadingAltLogo state
content = content.replace(
    'const [uploadingLogo, setUploadingLogo] = useState(false);',
    'const [uploadingLogo, setUploadingLogo] = useState(false);\n    const [uploadingAltLogo, setUploadingAltLogo] = useState(false);'
);

// 2. Add to responseKey union type
content = content.replace(
    'responseKey: "logo_url" | "icon_url" | "hero_image_url" | "cta_image_url";',
    'responseKey: "logo_url" | "alt_logo_url" | "icon_url" | "hero_image_url" | "cta_image_url";'
);
content = content.replace(
    '    }    const labelFromResponseKey = (responseKey: "logo_url" | "icon_url"',
    '    }    const labelFromResponseKey = (responseKey: "logo_url" | "alt_logo_url" | "icon_url"'
);
content = content.replace(
    'const labelFromResponseKey = (responseKey: "logo_url" | "icon_url" | "hero_image_url" | "cta_image_url") => {',
    'const labelFromResponseKey = (responseKey: "logo_url" | "alt_logo_url" | "icon_url" | "hero_image_url" | "cta_image_url") => {'
);

// 3. Add to labelFromResponseKey function switch case
if (content.includes('case "logo_url":\r\n')) {
    content = content.replace(
        'case "logo_url":\r\n                return t("Logo");',
        'case "logo_url":\r\n                return t("Logo");\r\n            case "alt_logo_url":\r\n                return t("Alternative Logo");'
    );
} else {
    content = content.replace(
        'case "logo_url":\n                return t("Logo");',
        'case "logo_url":\n                return t("Logo");\n            case "alt_logo_url":\n                return t("Alternative Logo");'
    );
}

// 4. Add handleAltLogoUpload function right after handleLogoUpload
const handleAltCode = `\n\n    const handleAltLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/jpg"];
        if (!validTypes.includes(file.type)) {
            toast({ title: t("Invalid file type"), description: t("Only SVG, PNG, and JPEG are supported"), variant: "destructive" });
            return;
        }

        await uploadLandingImage({
            file,
            endpoint: "/api/admin/landing/upload-alt-logo",
            responseKey: "alt_logo_url",
            setUploading: setUploadingAltLogo,
        });
    };`;

if (content.includes('setUploading: setUploadingLogo,\r\n        });\r\n    };')) {
    content = content.replace('setUploading: setUploadingLogo,\r\n        });\r\n    };', 'setUploading: setUploadingLogo,\r\n        });\r\n    };' + handleAltCode.replace(/\n/g, '\r\n'));
} else {
    content = content.replace('setUploading: setUploadingLogo,\n        });\n    };', 'setUploading: setUploadingLogo,\n        });\n    };' + handleAltCode);
}

// 5. Add the ImageUploadField for Alt Logo in the render tree under Logo Upload
const componentCode = `
                        {/* Alternative Logo Upload */}
                        <ImageUploadField
                            value={content.alt_logo_url ?? undefined}
                            onChange={handleAltLogoUpload}
                            uploading={uploadingAltLogo}
                            acceptedTypes={["image/svg+xml", "image/png", "image/jpeg", "image/jpg"]}
                            label="Alternative Landing Logo"
                            description="Colored mask logo to be revealed on hover (SVG, PNG, or JPEG)"
                        />`;

if (content.includes('description="Appears in header and footer (SVG, PNG, or JPEG)"\r\n                        />')) {
    content = content.replace(
        'description="Appears in header and footer (SVG, PNG, or JPEG)"\r\n                        />',
        'description="Appears in header and footer (SVG, PNG, or JPEG)"\r\n                        />\r\n' + componentCode.replace(/\n/g, '\r\n')
    );
} else {
    content = content.replace(
        'description="Appears in header and footer (SVG, PNG, or JPEG)"\n                        />',
        'description="Appears in header and footer (SVG, PNG, or JPEG)"\n                        />\n' + componentCode
    );
}

fs.writeFileSync(file, content);
console.log("Done");

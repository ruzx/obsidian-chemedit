import React, { useMemo } from "react";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import { Ketcher } from "ketcher-core";
import "ketcher-react/dist/index.css";

type Props = {
	data: string;
	onInit: (ketcher: Ketcher, subscriber: any) => void;
	onChange: () => void;
};

const KetcherReact = ({ data, onInit, onChange }: Props) => {
    // Generate a unique provider for this specific instance so the background 
    // renderer and popup editor don't fight over the same engine.
    const structServiceProvider = useMemo(() => new StandaloneStructServiceProvider(), []);

	return (
		<div style={{ width: '100%', height: '100%' }}>
			<Editor
				errorHandler={(_message: string) => { }}
				staticResourcesUrl={""}
				structServiceProvider={structServiceProvider}
				onInit={(ketcher: Ketcher) => {
                    // Try/Catch prevents malformed data from breaking the editor
                    try { ketcher.setMolecule(data); } catch(e) {}
					const subscriber = ketcher.editor.subscribe("change", operations => { onChange() })
					onInit(ketcher, subscriber);
				}}
			/>
		</div>
	);
};

export default KetcherReact;
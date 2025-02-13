import {
	IContextObject,
	INodeCredentialDescription,
	INode,
	INodeExecutionData,
	INodeIssues,
	INodeIssueObjectProperty,
	INodeParameters,
	INodeProperties,
	INodePropertyCollection,
	INodeType,
	IParameterDependencies,
	IRunExecutionData,
	IWebhookData,
	IWorkflowExecuteAdditionalData,
	NodeParameterValue,
	WebhookHttpMethod,
} from './Interfaces';

import {
	Workflow
} from './Workflow';

import { get } from 'lodash';

/**
 * Returns if the parameter should be displayed or not
 *
 * @export
 * @param {INodeParameters} nodeValues The data on the node which decides if the parameter
 *                                    should be displayed
 * @param {(INodeProperties | INodeCredentialDescription)} parameter The parameter to check if it should be displayed
 * @param {INodeParameters} [nodeValuesRoot] The root node-parameter-data
 * @returns
 */
export function displayParameter(nodeValues: INodeParameters, parameter: INodeProperties | INodeCredentialDescription, nodeValuesRoot?: INodeParameters) {
	if (!parameter.displayOptions) {
		return true;
	}

	nodeValuesRoot = nodeValuesRoot || nodeValues;

	let value;
	if (parameter.displayOptions.show) {
		// All the defined rules have to match to display parameter
		for (const propertyName of Object.keys(parameter.displayOptions.show)) {
			if (propertyName.charAt(0) === '/') {
				// Get the value from the root of the node
				value = nodeValuesRoot[propertyName.slice(1)];
			} else {
				// Get the value from current level
				value = nodeValues[propertyName];
			}

			if (value === undefined || !parameter.displayOptions.show[propertyName].includes(value as string)) {
				return false;
			}
		}
		return true;
	}

	if (parameter.displayOptions.hide) {
		// Any of the defined hide rules have to match to hide the paramter
		for (const propertyName of Object.keys(parameter.displayOptions.hide)) {
			if (propertyName.charAt(0) === '/') {
				// Get the value from the root of the node
				value = nodeValuesRoot[propertyName.slice(1)];
			} else {
				// Get the value from current level
				value = nodeValues[propertyName];
			}
			if (value !== undefined && parameter.displayOptions.hide[propertyName].includes(value as string)) {
				return false;
			}
		}
	}

	return true;
}


/**
 * Returns if the given parameter should be displayed or not considering the path
 * to the properties
 *
 * @export
 * @param {INodeParameters} nodeValues The data on the node which decides if the parameter
 *                                    should be displayed
 * @param {(INodeProperties | INodeCredentialDescription)} parameter The parameter to check if it should be displayed
 * @param {string} path The path to the property
 * @returns
 */
export function displayParameterPath(nodeValues: INodeParameters, parameter: INodeProperties | INodeCredentialDescription, path: string) {
	let resolvedNodeValues = nodeValues;
	if (path !== '') {
		resolvedNodeValues = get(
			nodeValues,
			path,
		) as INodeParameters;
	}

	// Get the root parameter data
	let nodeValuesRoot = nodeValues;
	if (path && path.split('.').indexOf('parameters') === 0) {
		nodeValuesRoot = get(
			nodeValues,
			'parameters',
		) as INodeParameters;
	}

	return displayParameter(resolvedNodeValues, parameter, nodeValuesRoot);
}


/**
 * Returns the context data
 *
 * @export
 * @param {IRunExecutionData} runExecutionData The run execution data
 * @param {string} type The data type. "node"/"flow"
 * @param {INode} [node] If type "node" is set the node to return the context of has to be supplied
 * @returns {IContextObject}
 */
export function getContext(runExecutionData: IRunExecutionData, type: string, node?: INode): IContextObject {
	if (runExecutionData.executionData === undefined) {
		// TODO: Should not happen leave it for test now
		throw new Error('The "executionData" is not initialized!');
	}

	let key: string;
	if (type === 'flow') {
		key = 'flow';
	} else if (type === 'node') {
		if (node === undefined) {
			throw new Error(`The request data of context type "node" the node parameter has to be set!`);
		}
		key = `node:${node.name}`;
	} else {
		throw new Error(`The context type "${type}" is not know. Only "flow" and node" are supported!`);
	}

	if (runExecutionData.executionData.contextData[key] === undefined) {
		runExecutionData.executionData.contextData[key] = {};
	}

	return runExecutionData.executionData.contextData[key];
}


/**
 * Returns which parameters are dependent on which
 *
 * @export
 * @param {INodeProperties[]} nodePropertiesArray
 * @returns {IParameterDependencies}
 */
export function getParamterDependencies(nodePropertiesArray: INodeProperties[]): IParameterDependencies {
	const dependencies: IParameterDependencies = {};

	let displayRule: string;
	let parameterName: string;
	for (const nodeProperties of nodePropertiesArray) {
		if (dependencies[nodeProperties.name] === undefined) {
			dependencies[nodeProperties.name] = [];
		}
		if (nodeProperties.displayOptions === undefined) {
			// Does not have any dependencies
			continue;
		}

		for (displayRule of Object.keys(nodeProperties.displayOptions)) {
			// @ts-ignore
			for (parameterName of Object.keys(nodeProperties.displayOptions[displayRule])) {
				if (!dependencies[nodeProperties.name].includes(parameterName)) {
					dependencies[nodeProperties.name].push(parameterName);
				}
			}
		}
	}

	return dependencies;
}


/**
 * Returns in which order the parameters should be resolved
 * to have the paramters available they are depent on
 *
 * @export
 * @param {INodeProperties[]} nodePropertiesArray
 * @param {IParameterDependencies} parameterDependencies
 * @returns {number[]}
 */
export function getParamterResolveOrder(nodePropertiesArray: INodeProperties[], parameterDependencies: IParameterDependencies): number[] {
	const executionOrder: number[] = [];
	const indexToResolve = Array.from({ length: nodePropertiesArray.length }, (v, k) => k);
	const resolvedParamters: string[] = [];

	let index: number;
	let property: INodeProperties;

	let lastIndexLength = indexToResolve.length;
	let lastIndexReduction = -1;

	let itterations = 0 ;

	while (indexToResolve.length !== 0) {
		itterations += 1;

		index = indexToResolve.shift() as number;
		property = nodePropertiesArray[index];

		if (parameterDependencies[property.name].length === 0) {
			// Does not have any dependencies so simply add
			executionOrder.push(index);
			resolvedParamters.push(property.name);
			continue;
		}

		// Parameter has dependencies
		for (const dependency of parameterDependencies[property.name]) {
			if (!resolvedParamters.includes(dependency)) {
				if (dependency.charAt(0) === '/') {
					// Assume that root level depenencies are resolved
					continue;
				}
				// Dependencies for that paramter are still missing so
				// try to add again later
				indexToResolve.push(index);
				continue;
			}
		}

		// All dependencies got found so add
		executionOrder.push(index);
		resolvedParamters.push(property.name);

		if (indexToResolve.length < lastIndexLength) {
			lastIndexReduction = itterations;
		}

		if (itterations > lastIndexReduction + nodePropertiesArray.length) {
			throw new Error('Could not resolve parameter depenencies!');
		}
		lastIndexLength = indexToResolve.length;
	}

	return executionOrder;
}


/**
 * Returns the node parameter values. Depending on the settings it either just returns the none
 * default values or it applies all the default values.
 *
 * @export
 * @param {INodeProperties[]} nodePropertiesArray The properties which exist and their settings
 * @param {INodeParameters} nodeValues The node parameter data
 * @param {boolean} returnDefaults If default values get added or only none default values returned
 * @param {boolean} returnNoneDisplayed If also values which should not be displayed should be returned
 * @param {boolean} [onlySimpleTypes=false] If only simple types should be resolved
 * @param {boolean} [dataIsResolved=false] If nodeValues are already fully resolved (so that all default values got added already)
 * @param {INodeParameters} [nodeValuesRoot] The root node-parameter-data
 * @returns {(INodeParameters | null)}
 */
export function getNodeParameters(nodePropertiesArray: INodeProperties[], nodeValues: INodeParameters, returnDefaults: boolean, returnNoneDisplayed: boolean, onlySimpleTypes = false, dataIsResolved = false, nodeValuesRoot?: INodeParameters, parentType?: string, parameterDependencies?: IParameterDependencies): INodeParameters | null {
	if (parameterDependencies === undefined) {
		parameterDependencies = getParamterDependencies(nodePropertiesArray);
	}

	// Get the parameter names which get used multiple times as for this
	// ones we have to always check which ones get displayed and which ones not
	const duplicateParameterNames: string[] = [];
	const parameterNames: string[] = [];
	for (const nodeProperties of nodePropertiesArray) {
		if (parameterNames.includes(nodeProperties.name)) {
			if (!duplicateParameterNames.includes(nodeProperties.name)) {
				duplicateParameterNames.push(nodeProperties.name);
			}
		} else {
			parameterNames.push(nodeProperties.name);
		}
	}

	const nodeParameters: INodeParameters = {};
	const nodeParametersFull: INodeParameters = {};

	let nodeValuesDisplayCheck = nodeParametersFull;
	if (dataIsResolved !== true && returnNoneDisplayed === false) {
		nodeValuesDisplayCheck = getNodeParameters(nodePropertiesArray, nodeValues, true, true, true, true, nodeValuesRoot, parentType, parameterDependencies) as INodeParameters;
	}

	nodeValuesRoot = nodeValuesRoot || nodeValuesDisplayCheck;

	// Go through the parameters in order of their dependencies
	const parameterItterationOrderIndex = getParamterResolveOrder(nodePropertiesArray, parameterDependencies);

	for (const parameterIndex of parameterItterationOrderIndex) {
		const nodeProperties = nodePropertiesArray[parameterIndex];
		if (nodeValues[nodeProperties.name] === undefined && (returnDefaults === false || parentType === 'collection')) {
			// The value is not defined so go to the next
			continue;
		}

		if (returnNoneDisplayed === false && !displayParameter(nodeValuesDisplayCheck, nodeProperties, nodeValuesRoot)) {
			if (returnNoneDisplayed === false) {
				continue;
			}
			if (returnDefaults === false) {
				continue;
			}
		}

		if (!['collection', 'fixedCollection'].includes(nodeProperties.type)) {
			// Is a simple property so can be set as it is

			if (duplicateParameterNames.includes(nodeProperties.name)) {
				if (!displayParameter(nodeValuesDisplayCheck, nodeProperties, nodeValuesRoot)) {
					continue;
				}
			}

			if (returnDefaults === true) {
				// Set also when it has the default value
				if (['boolean', 'number'].includes(nodeProperties.type)) {
					// Boolean and numbers are special as false and 0 are valid values
					// and should not be replaced with default value
					nodeParameters[nodeProperties.name] = nodeValues[nodeProperties.name] !== undefined ? nodeValues[nodeProperties.name] : nodeProperties.default;
				} else {
					nodeParameters[nodeProperties.name] = nodeValues[nodeProperties.name] || nodeProperties.default;
				}
				nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
			} else if (nodeValues[nodeProperties.name] !== nodeProperties.default || (nodeValues[nodeProperties.name] !== undefined && parentType === 'collection')) {
				// Set only if it is different to the default value
				nodeParameters[nodeProperties.name] = nodeValues[nodeProperties.name];
				nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				continue;
			}
		}

		if (onlySimpleTypes === true) {
			// It is only supposed to resolve the simple types. So continue.
			continue;
		}

		// Is a complex property so check lower levels
		let tempValue: INodeParameters | null;
		if (nodeProperties.type === 'collection') {
			// Is collection

			if (nodeProperties.typeOptions !== undefined && nodeProperties.typeOptions.multipleValues === true) {
				// Multiple can be set so will be an array

				// Return directly the values like they are
				if (nodeValues[nodeProperties.name] !== undefined) {
					nodeParameters[nodeProperties.name] = nodeValues[nodeProperties.name];
				} else if (returnDefaults === true) {
					// Does not have values defined but defaults should be returned which is in the
					// case of a collection with multipleValues always an empty array
					nodeParameters[nodeProperties.name] = [];
				}
				nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
			} else {
				if (nodeValues[nodeProperties.name] !== undefined) {
					// Has values defined so get them
					const tempNodeParameters = getNodeParameters(nodeProperties.options as INodeProperties[], nodeValues[nodeProperties.name] as INodeParameters, returnDefaults, returnNoneDisplayed, false, false, nodeValuesRoot, nodeProperties.type);

					if (tempNodeParameters !== null) {
						nodeParameters[nodeProperties.name] = tempNodeParameters;
						nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
					}
				} else if (returnDefaults === true) {
					// Does not have values defined but defaults should be returned
					nodeParameters[nodeProperties.name] = JSON.parse(JSON.stringify(nodeProperties.default));
					nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				}
			}
		} else if (nodeProperties.type === 'fixedCollection') {
			// Is fixedCollection

			const collectionValues: INodeParameters = {};
			let tempNodeParameters: INodeParameters;
			let tempNodePropertiesArray: INodeProperties[];
			let nodePropertyOptions: INodePropertyCollection | undefined;

			let propertyValues = nodeValues[nodeProperties.name];
			if (returnDefaults === true) {
				if (propertyValues === undefined) {
					propertyValues = JSON.parse(JSON.stringify(nodeProperties.default));
				}
			}

			// Itterate over all collections
			for (const itemName of Object.keys(propertyValues)) {
				if (nodeProperties.typeOptions !== undefined && nodeProperties.typeOptions.multipleValues === true) {
					// Multiple can be set so will be an array

					const tempArrayValue: INodeParameters[] = [];
					// Itterate over all items as it contains multiple ones
					for (const nodeValue of (propertyValues as INodeParameters)[itemName] as INodeParameters[]) {
						nodePropertyOptions = nodeProperties!.options!.find((nodePropertyOptions) => nodePropertyOptions.name === itemName) as INodePropertyCollection;

						if (nodePropertyOptions === undefined) {
							throw new Error(`Could not find property option "${itemName}" for "${nodeProperties.name}"`);
						}

						tempNodePropertiesArray = (nodePropertyOptions as INodePropertyCollection).values!;
						tempValue = getNodeParameters(tempNodePropertiesArray, nodeValue as INodeParameters, returnDefaults, returnNoneDisplayed, false, false, nodeValuesRoot, nodeProperties.type);
						if (tempValue !== null) {
							tempArrayValue.push(tempValue);
						}
					}
					collectionValues[itemName] = tempArrayValue;
				} else {
					// Only one can be set so is an object of objects
					tempNodeParameters = {};

					// Get the options of the current item
					const nodePropertyOptions = nodeProperties!.options!.find((data) => data.name === itemName);

					if (nodePropertyOptions !== undefined) {
						tempNodePropertiesArray = (nodePropertyOptions as INodePropertyCollection).values!;
						tempValue = getNodeParameters(tempNodePropertiesArray, (nodeValues[nodeProperties.name] as INodeParameters)[itemName] as INodeParameters, returnDefaults, returnNoneDisplayed, false, false, nodeValuesRoot, nodeProperties.type);
						if (tempValue !== null) {
							Object.assign(tempNodeParameters, tempValue);
						}
					}

					if (Object.keys(tempNodeParameters).length !== 0) {
						collectionValues[itemName] = tempNodeParameters;
					}
				}
			}

			if (Object.keys(collectionValues).length !== 0 || returnDefaults === true) {
				// Set only if value got found

				if (returnDefaults === true) {
					// Set also when it has the default value
					if (collectionValues === undefined) {
						nodeParameters[nodeProperties.name] = JSON.parse(JSON.stringify(nodeProperties.default));
					} else {
						nodeParameters[nodeProperties.name] = collectionValues;
					}
					nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				} else if (collectionValues !== nodeProperties.default) {
					// Set only if values got found and it is not the default
					nodeParameters[nodeProperties.name] = collectionValues;
					nodeParametersFull[nodeProperties.name] = nodeParameters[nodeProperties.name];
				}
			}
		}
	}

	return nodeParameters;
}


/**
 * Brings the output data in a format that can be returned from a node
 *
 * @export
 * @param {INodeExecutionData[]} outputData
 * @param {number} [outputIndex=0]
 * @returns {Promise<INodeExecutionData[][]>}
 */
export async function prepareOutputData(outputData: INodeExecutionData[], outputIndex = 0): Promise<INodeExecutionData[][]> {
	// TODO: Check if node has output with that index
	const returnData = [];

	for (let i = 0; i < outputIndex; i++) {
		returnData.push([]);
	}

	returnData.push(outputData);

	return returnData;
}



/**
 * Returns all the webhooks which should be created for the give node
 *
 * @export
 *
 * @param {INode} node
 * @returns {IWebhookData[]}
 */
export function getNodeWebhooks(workflow: Workflow, node: INode, additionalData: IWorkflowExecuteAdditionalData): IWebhookData[] {
	if (node.disabled === true) {
		// Node is disabled so webhooks will also not be enabled
		return [];
	}

	if (workflow.id === undefined) {
		// Workflow has no id which means it is not saved and so  webhooks
		// will not be enabled
		return [];
	}

	const nodeType = workflow.nodeTypes.getByName(node.type) as INodeType;

	if (nodeType.description.webhooks === undefined) {
		// Node does not have any webhooks so return
		return [];
	}

	const returnData: IWebhookData[] = [];
	for (const webhookDescription of nodeType.description.webhooks) {
		let nodeWebhookPath = workflow.getSimpleParameterValue(node, webhookDescription['path'], 'GET');
		if (nodeWebhookPath === undefined) {
			// TODO: Use a proper logger
			console.error(`No webhook path could be found for node "${node.name}" in workflow "${workflow.id}".`);
			continue;
		}

		nodeWebhookPath = nodeWebhookPath.toString();

		if (nodeWebhookPath.charAt(0) === '/') {
			nodeWebhookPath = nodeWebhookPath.slice(1);
		}

		const path = getNodeWebhookPath(workflow.id, node, nodeWebhookPath);

		const httpMethod = workflow.getSimpleParameterValue(node, webhookDescription['httpMethod'], 'GET');

		if (httpMethod === undefined) {
			// TODO: Use a proper logger
			console.error(`The webhook "${path}" for node "${node.name}" in workflow "${workflow.id}" could not be added because the httpMethod is not defined.`);
			continue;
		}

		returnData.push({
			httpMethod: httpMethod.toString() as WebhookHttpMethod,
			node: node.name,
			path,
			webhookDescription,
			workflow,
			workflowExecuteAdditionalData: additionalData,
		});
	}

	return returnData;
}


/**
 * Returns the webhook path
 *
 * @export
 * @param {string} workflowId
 * @param {string} nodeTypeName
 * @param {string} path
 * @returns {string}
 */
export function getNodeWebhookPath(workflowId: string, node: INode, path: string): string {
	return `${workflowId}/${encodeURIComponent(node.name.toLowerCase())}/${path}`;
}


/**
 * Returns the webhook URL
 *
 * @export
 * @param {string} baseUrl
 * @param {string} workflowId
 * @param {string} nodeTypeName
 * @param {string} path
 * @returns {string}
 */
export function getNodeWebhookUrl(baseUrl: string, workflowId: string, node: INode, path: string): string {
	// return `${baseUrl}/${workflowId}/${nodeTypeName}/${path}`;
	return `${baseUrl}/${getNodeWebhookPath(workflowId, node, path)}`;
}


/**
 * Returns all the parameter-issues of the node
 *
 * @export
 * @param {INodeProperties[]} nodePropertiesArray The properties of the node
 * @param {INode} node The data of the node
 * @returns {(INodeIssues | null)}
 */
export function getNodeParametersIssues(nodePropertiesArray: INodeProperties[], node: INode): INodeIssues | null {
	const foundIssues: INodeIssues = {};
	let propertyIssues: INodeIssues;

	if (node.disabled === true) {
		// Ignore issues on disabled nodes
		return null;
	}

	for (const nodeProperty of nodePropertiesArray) {
		propertyIssues = getParameterIssues(nodeProperty, node.parameters, '');
		mergeIssues(foundIssues, propertyIssues);
	}

	if (Object.keys(foundIssues).length === 0) {
		return null;
	}

	return foundIssues;
}


/**
 * Returns the issues of the node as string
 *
 * @export
 * @param {INodeIssues} issues The issues of the node
 * @param {INode} node The node
 * @returns {string[]}
 */
export function nodeIssuesToString(issues: INodeIssues, node?: INode): string[] {
	const nodeIssues = [];

	if (issues.execution !== undefined) {
		nodeIssues.push(`Execution Error.`);
	}

	const objectProperties = [
		'parameters',
		'credentials',
	];

	let issueText: string, parameterName: string;
	for (const propertyName of objectProperties) {
		if (issues[propertyName] !== undefined) {
			for (parameterName of Object.keys(issues[propertyName] as object)) {
				for (issueText of (issues[propertyName] as INodeIssueObjectProperty)[parameterName]) {
					nodeIssues.push(issueText);
				}
			}
		}
	}

	if (issues.typeUnknown !== undefined) {
		if (node !== undefined) {
			nodeIssues.push(`Node Type "${node.type}" is not known.`);
		} else {
			nodeIssues.push(`Node Type is not known.`);
		}
	}

	return nodeIssues;
}


/**
 * Adds an issue if the parameter is not defined
 *
 * @export
 * @param {INodeIssues} foundIssues The already found issues
 * @param {INodeProperties} nodeProperties The properties of the node
 * @param {NodeParameterValue} value The value of the parameter
 */
export function addToIssuesIfMissing(foundIssues: INodeIssues, nodeProperties: INodeProperties, value: NodeParameterValue) {
	// TODO: Check what it really has when undefined
	if ((nodeProperties.type === 'string' && (value === '' || value === undefined)) ||
		(nodeProperties.type === 'multiOptions' && Array.isArray(value) && value.length === 0) ||
		(nodeProperties.type === 'dateTime' && value === undefined)) {
		// Parameter is requried but empty
		if (foundIssues.parameters === undefined) {
			foundIssues.parameters = {};
		}
		if (foundIssues.parameters[nodeProperties.name] === undefined) {
			foundIssues.parameters[nodeProperties.name] = [];
		}

		foundIssues.parameters[nodeProperties.name].push(`Parameter "${nodeProperties.displayName}" is required.`);
	}
}


/**
 * Returns the parameter value
 *
 * @export
 * @param {INodeParameters} nodeValues The values of the node
 * @param {string} parameterName The name of the parameter to return the value of
 * @param {string} path The path to the properties
 * @returns
 */
export function getParameterValueByPath(nodeValues: INodeParameters, parameterName: string, path: string) {
	return get(
		nodeValues,
		path ? path + '.' + parameterName : parameterName,
	);
}



/**
 * Returns all the issues with the given node-values
 *
 * @export
 * @param {INodeProperties} nodeProperties The properties of the node
 * @param {INodeParameters} nodeValues The values of the node
 * @param {string} path The path to the properties
 * @returns {INodeIssues}
 */
export function getParameterIssues(nodeProperties: INodeProperties, nodeValues: INodeParameters, path: string): INodeIssues {
	const foundIssues: INodeIssues = {};
	let value;

	if (nodeProperties.required === true) {
		if (displayParameterPath(nodeValues, nodeProperties, path)) {
			value = getParameterValueByPath(nodeValues, nodeProperties.name, path);

			if (nodeProperties.typeOptions !== undefined && nodeProperties.typeOptions.multipleValues !== undefined) {
				// Multiple can be set so will be an array
				if (Array.isArray(value)) {
					for (const singleValue of value as NodeParameterValue[]) {
						addToIssuesIfMissing(foundIssues, nodeProperties, singleValue as NodeParameterValue);
					}
				}
			} else {
				// Only one can be set so will be a single value
				addToIssuesIfMissing(foundIssues, nodeProperties, value as NodeParameterValue);
			}
		}
	}

	// Check if there are any child parameters
	if (nodeProperties.options === undefined) {
		// There are none so nothing else to check
		return foundIssues;
	}

	// Check the child parameters

	// Important:
	// Checks the child properties only if the property is defined on current level.
	// That means that the required flag works only for the current level only. If
	// it is set on a lower level it means that the property is only required in case
	// the parent property got set.

	let basePath = path ? `${path}.` : '';

	const checkChildNodeProperties: Array<{
		basePath: string;
		data: INodeProperties;
	}> = [];

	// Collect all the properties to check
	if (nodeProperties.type === 'collection') {
		for (const option of nodeProperties.options) {
			checkChildNodeProperties.push({
				basePath,
				data: option as INodeProperties,
			});
		}
	} else if (nodeProperties.type === 'fixedCollection') {
		basePath = basePath ? `${basePath}.` : '' + nodeProperties.name + '.';

		let propertyOptions: INodePropertyCollection;
		for (propertyOptions of nodeProperties.options as INodePropertyCollection[]) {
			// Check if the option got set and if not skip it
			value = getParameterValueByPath(nodeValues, propertyOptions.name, basePath.slice(0, -1));
			if (value === undefined) {
				continue;
			}

			if (nodeProperties.typeOptions !== undefined && nodeProperties.typeOptions.multipleValues !== undefined) {
				// Multiple can be set so will be an array of objects
				if (Array.isArray(value)) {
					for (let i = 0; i < (value as INodeParameters[]).length; i++) {
						for (const option of propertyOptions.values) {
							checkChildNodeProperties.push({
								basePath: `${basePath}${propertyOptions.name}[${i}]`,
								data: option as INodeProperties,
							});
						}
					}
				}
			} else {
				// Only one can be set so will be an object
				for (const option of propertyOptions.values) {
					checkChildNodeProperties.push({
						basePath: basePath + propertyOptions.name,
						data: option as INodeProperties,
					});
				}
			}
		}
	} else {
		// For all other types there is nothing to check so return
		return foundIssues;
	}

	let propertyIssues;

	for (const optionData of checkChildNodeProperties) {
		propertyIssues = getParameterIssues(optionData.data as INodeProperties, nodeValues, optionData.basePath);
		mergeIssues(foundIssues, propertyIssues);
	}

	return foundIssues;
}


/**
 * Merges multiple NodeIssues together
 *
 * @export
 * @param {INodeIssues} destination The issues to merge into
 * @param {(INodeIssues | null)} source The issues to merge
 * @returns
 */
export function mergeIssues(destination: INodeIssues, source: INodeIssues | null) {
	if (source === null) {
		// Nothing to merge
		return;
	}

	if (source.execution === true) {
		destination.execution = true;
	}

	const objectProperties = [
		'parameters',
		'credentials',
	];

	let destinationProperty: INodeIssueObjectProperty;
	for (const propertyName of objectProperties) {
		if (source[propertyName] !== undefined) {
			if (destination[propertyName] === undefined) {
				destination[propertyName] = {};
			}

			let parameterName: string;
			for (parameterName of Object.keys(source[propertyName] as INodeIssueObjectProperty)) {
				destinationProperty = destination[propertyName] as INodeIssueObjectProperty;
				if (destinationProperty[parameterName] === undefined) {
					destinationProperty[parameterName] = [];
				}
				destinationProperty[parameterName].push.apply(destinationProperty[parameterName], (source[propertyName] as INodeIssueObjectProperty)[parameterName]);
			}
		}
	}

	if (source.typeUnknown === true) {
		destination.typeUnknown = true;
	}
}
